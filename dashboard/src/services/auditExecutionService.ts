import { prisma } from '../config/prisma.js';
import { FirecrawlService } from './firecrawlService.js';
import { ReconciliationEngine } from './reconciliationEngine.js';
import { NormsResolver } from './normsResolver.js';
import { EmailService } from './emailService.js';
import { AIStructuredContractAdapter } from '../shared/aiStructuredContract.js';
import { ExtractionMode } from '@prisma/client';

export interface ExecuteAuditParams {
  auditReportId: string;
  clientId: string;
  targetUrl: string;
  agentModuleId?: string;
  skill?: string;
  extractionMode?: ExtractionMode;
  jobId?: string | number;
}

export class AuditExecutionService {
  /**
   * Executa o pipeline completo de Governança de IA e Auditoria Deontológica:
   * 1. Atualização de status para RUNNING
   * 2. Scraping exclusivo via Firecrawl (ou fallback com Markdown limpo e hash SHA-256)
   * 3. Persistência dos dados brutos no MongoDB (module_scrape_data)
   * 4. Resolução dinâmica de normas por Tags no banco de dados
   * 5. Invocação da IA e Reconciliação Deontológica (Gemini / Ollama / Heurística)
   * 6. Gravação do Laudo de Auditoria e Violações no banco de dados
   * 7. Telemetria e logs operacionais com contagem de tokens
   */
  public static async execute(params: ExecuteAuditParams): Promise<{
    success: boolean;
    auditReportId: string;
    verdict?: string;
    score?: number;
    violationsCount?: number;
  }> {
    const { auditReportId, clientId, targetUrl, agentModuleId, jobId } = params;
    const startTime = Date.now();
    const correlationId = auditReportId;

    console.log(`[AuditExecutionService] Iniciando pipeline para Report: ${auditReportId} | URL: ${targetUrl} (Job: ${jobId || 'direct'})`);

    try {
      // 1. Marca o laudo como RUNNING
      await prisma.auditReport.update({
        where: { id: auditReportId },
        data: { status: 'RUNNING' },
      });

      // Recupera dados do cliente e módulo para contexto
      const [client, mod] = await Promise.all([
        prisma.client.findUnique({ where: { id: clientId } }).catch(() => null),
        agentModuleId
          ? prisma.agentModule.findFirst({
              where: { OR: [{ id: agentModuleId }, { code: agentModuleId }] },
            }).catch(() => null)
          : null,
      ]);

      const clientName = client?.name || client?.tradeName || 'Clínica Auditada';
      const moduleName = mod?.name || 'Módulo Geral';
      const moduleTags = mod?.tags && mod.tags.length > 0 ? mod.tags : ['CFM'];
      const effectiveSkill = params.skill || mod?.description || 'compliance-specialist';

      // Log operacional: Início da extração
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'SCRAPER',
          correlationId,
          message: `[SCRAPER] [FIRECRAWL] Acionando extração de página via Firecrawl para: ${targetUrl} (Cliente: ${clientName})`,
        },
      }).catch(() => {});

      // 2 & 3. Scraping Exclusivo via Firecrawl + Hash SHA-256 + MongoDB
      const firecrawlResult = await FirecrawlService.scrape(targetUrl, agentModuleId, clientId);

      // T04: Validação estrita de integridade do conteúdo extraído
      if (!firecrawlResult || !firecrawlResult.markdown || firecrawlResult.markdown.trim().length === 0) {
        throw new Error('Conteúdo extraído vazio ou inexistente. Auditoria deontológica abortada para evitar geração de laudo inconsequente.');
      }

      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'SCRAPER',
          correlationId,
          message: `[SCRAPER] [FIRECRAWL] Conteúdo extraído em Markdown limpo (${firecrawlResult.markdown.length} caracteres) | Hash SHA-256: ${firecrawlResult.contentHash} | Persistido em 'module_scrape_data'`,
          details: JSON.stringify({
            moduleId: agentModuleId,
            url: targetUrl,
            contentHash: firecrawlResult.contentHash,
            source: firecrawlResult.source,
            savedRecordId: firecrawlResult.savedRecordId,
          }),
        },
      }).catch(() => {});

      // 4. Resolução Dinâmica de Normas no Banco de Dados através das Tags do Módulo
      const agentContext = await ReconciliationEngine.resolveAgentContext(agentModuleId);
      const allFilesAndNorms = agentContext.activeNorms.map(
        (n) => `${n.normCode}${n.article ? ` (${n.article})` : ''}: ${n.title}`
      );
      const normsFilesNames = agentContext.resolvedDbNorms?.map((n) => n.normCode || n.title) || [];
      const combinedNormsList = Array.from(new Set([...allFilesAndNorms, ...normsFilesNames]));

      // Log operacional dedicado das normas e arquivos normativos acionados na telemetria
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'AI_NORMS',
          correlationId,
          message: `📚 [AI_NORMS] ${combinedNormsList.length} arquivo(s)/norma(s) regulatória(s) carregados para comunicação com IA: ${combinedNormsList.slice(0, 3).join(' | ')}${combinedNormsList.length > 3 ? ` (+${combinedNormsList.length - 3} normas)` : ''}`,
          details: JSON.stringify({
            moduleId: agentModuleId,
            moduleName,
            tags: moduleTags,
            totalNormsCount: combinedNormsList.length,
            normsAndFilesUsed: combinedNormsList,
            sources: ['MongoDB (scraped_pages)', 'normas/*.md', 'NORMS_CATALOG'],
          }),
        },
      }).catch(() => {});

      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'AI_ENGINE',
          correlationId,
          message: `[AI_INTERACTION] Invocando IA com Skill: "${effectiveSkill}" | Contexto com ${combinedNormsList.length} normas ativas para tags: [${moduleTags.join(', ')}]`,
        },
      }).catch(() => {});

      // Adaptador para o formato do ReconciliationEngine
      const scrapeAdapter = {
        url: targetUrl,
        title: mod?.name || clientName,
        rawHtmlLength: firecrawlResult.markdown.length,
        cleanMarkdown: firecrawlResult.markdown,
        tokensEstimatedRaw: Math.ceil(firecrawlResult.markdown.length / 3),
        tokensEstimatedClean: Math.ceil(firecrawlResult.markdown.length / 4),
        extractedEntities: {
          crms: [] as string[],
          rqes: [] as string[],
          states: [] as string[],
          hasBeforeAfterMention: firecrawlResult.markdown.toLowerCase().includes('antes e depois'),
          hasPromotionalPricing: /promoção|desconto|black friday|cupom|sorteio|combo/i.test(firecrawlResult.markdown),
          hasGuaranteedResultMention: /100%|garantido|cura definitiva|o melhor|resultado certo/i.test(firecrawlResult.markdown),
        },
      };

      // 5. Invocação da IA e Reconciliação Deontológica
      const recon = await ReconciliationEngine.reconcile(scrapeAdapter as any, agentModuleId);
      const executionTimeMs = Date.now() - startTime;

      // Telemetria e log de IA com tokens e fontes/normas utilizadas
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'AI_ENGINE',
          correlationId,
          message: `[AI_INTERACTION] Veredito da IA emitido: ${recon.verdict} (Score: ${recon.score}) | Prompt Tokens: ${recon.promptTokens} | Completion Tokens: ${recon.completionTokens} | Total Tokens: ${recon.totalTokens} | Latência: ${executionTimeMs}ms | Normas Aplicadas: ${recon.sourcesUsed.length}`,
          details: JSON.stringify({
            aiModelUsed: recon.aiModelUsed,
            verdict: recon.verdict,
            score: recon.score,
            promptTokens: recon.promptTokens,
            completionTokens: recon.completionTokens,
            totalTokens: recon.totalTokens,
            executionTimeMs,
            sourcesUsed: recon.sourcesUsed,
          }),
        },
      }).catch(() => {});

      // Gera Contrato Estruturado de Alta Confiabilidade
      const structuredContract = AIStructuredContractAdapter.toStructuredContract(recon, auditReportId);
      const requiresHumanReview = structuredContract.findings.some((f) => f.requires_human_review);

      // 6. Persistência Transacional no MongoDB (AuditReport e Violations)
      await prisma.$transaction(async (tx) => {
        await tx.auditReport.update({
          where: { id: auditReportId },
          data: {
            status: 'COMPLETED',
            verdict: recon.verdict,
            score: recon.score,
            summary: recon.summary,
            riskLevel: structuredContract.risk_level,
            confidence: structuredContract.confidence,
            structuredContract: JSON.stringify(structuredContract),
            groundingScore: recon.groundingScore ?? 100,
            hallucinationRisk: recon.hallucinationRisk ?? 'NONE',
            guardrailsApplied: recon.guardrailsApplied ?? false,
            requiresHumanReview,
            rawContent: firecrawlResult.rawContent,
            cleanMarkdown: firecrawlResult.markdown,
            tokensSaved: Math.max(0, scrapeAdapter.tokensEstimatedRaw - scrapeAdapter.tokensEstimatedClean),
            promptTokens: recon.promptTokens,
            completionTokens: recon.completionTokens,
            totalTokens: recon.totalTokens,
            sourcesUsed: recon.sourcesUsed,
            aiModelUsed: recon.aiModelUsed,
            executionTimeMs,
          },
        });

        // Limpa violações pré-existentes se houver reprocessamento
        await tx.violation.deleteMany({
          where: { auditReportId },
        });

        if (recon.violations.length > 0) {
          await tx.violation.createMany({
            data: recon.violations.map((v) => ({
              auditReportId,
              normArticle: v.normArticle,
              normCode: v.normCode,
              severity: v.severity,
              detectedText: v.detectedText,
              correctiveAdvice: v.correctiveAdvice,
              resolved: false,
            })),
          });
        }
      });

      // Log de sucesso com telemetria de guardrails
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'RECONCILIATION',
          correlationId,
          message: `[RECONCILIATION] Auditoria concluída com sucesso para "${clientName}" | ${recon.violations.length} infrações detectadas | Grounding: ${recon.groundingScore ?? 100}% | Status: COMPLETED | Tempo: ${executionTimeMs}ms`,
          details: JSON.stringify({
            auditReportId,
            score: recon.score,
            verdict: recon.verdict,
            violationsCount: recon.violations.length,
            executionTimeMs,
            groundingScore: recon.groundingScore ?? 100,
            hallucinationRisk: recon.hallucinationRisk ?? 'NONE',
            guardrailsApplied: recon.guardrailsApplied ?? false,
            hallucinationsInterceptedCount: recon.hallucinationsInterceptedCount ?? 0,
          }),
        },
      }).catch(() => {});

      // 7. Notificação por E-mail do Laudo Concluído para a Clínica (Resend Email API)
      if (clientId) {
        try {
          const client = await prisma.client.findUnique({
            where: { id: clientId },
            include: { users: { select: { email: true } } },
          });

          const recipientEmail = client?.email || (client?.users && client.users.length > 0 ? client.users[0].email : null);
          if (recipientEmail) {
            await EmailService.sendAuditReportCompletedEmail(recipientEmail, clientName, {
              id: auditReportId,
              targetUrl,
              score: recon.score,
              verdict: recon.verdict,
              summary: recon.summary,
              violationsCount: recon.violations.length,
            });
          }
        } catch (emailErr: any) {
          console.warn(`[AuditExecutionService] Aviso ao enviar notificação de laudo por e-mail: ${emailErr.message}`);
        }
      }

      console.log(`✅ [AuditExecutionService] Concluído com sucesso para ${auditReportId} em ${executionTimeMs}ms (Veredito: ${recon.verdict}, Violações: ${recon.violations.length})`);

      return {
        success: true,
        auditReportId,
        verdict: recon.verdict,
        score: recon.score,
        violationsCount: recon.violations.length,
      };
    } catch (error: any) {
      console.error(`❌ [AuditExecutionService] Falha na auditoria ${auditReportId}:`, error);

      await prisma.auditReport.update({
        where: { id: auditReportId },
        data: {
          status: 'FAILED',
          summary: `Falha técnica durante a execução da auditoria: ${error.message}`,
          score: 0,
          requiresHumanReview: true,
        },
      }).catch(() => {});

      await prisma.systemLog.create({
        data: {
          level: 'ERROR',
          module: 'AUDIT_WORKER',
          correlationId,
          message: `[AUDIT_ERROR] Falha no processamento da auditoria: ${error.message}`,
          details: error.stack,
        },
      }).catch(() => {});

      throw error;
    }
  }
}
