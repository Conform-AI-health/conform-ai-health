import { prisma } from '../config/prisma.js';
import { FirecrawlService } from './firecrawlService.js';
import { ReconciliationEngine } from './reconciliationEngine.js';
import { NormsResolver } from './normsResolver.js';
import { EmailService } from './emailService.js';
import { AIStructuredContractAdapter } from '../shared/aiStructuredContract.js';
import { ExtractionMode } from '@prisma/client';
import { ScraperService, ScrapeResult } from './scraperService.js';

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
      // 1. Marca o laudo como RUNNING e recupera vínculo de cliente existente
      const updatedReport = await prisma.auditReport.update({
        where: { id: auditReportId },
        data: { status: 'RUNNING' },
        select: { clientId: true },
      }).catch(() => null);

      const effectiveClientId = clientId || updatedReport?.clientId;

      // Recupera dados do módulo para contexto
      const mod = agentModuleId
        ? await prisma.agentModule.findFirst({
            where: { OR: [{ id: agentModuleId }, { code: agentModuleId }] },
          }).catch(() => null)
        : null;

      const finalClientId = effectiveClientId || mod?.clientId;

      const client = finalClientId
        ? await prisma.client.findUnique({
            where: { id: finalClientId },
            include: { users: { select: { email: true, name: true } } },
          }).catch(() => null)
        : null;

      const clientName = client?.name || client?.tradeName || 'Clínica Auditada';
      const moduleName = mod?.name || 'Módulo Geral';
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
      const retrievalStartedAt = Date.now();
      const agentContext = await ReconciliationEngine.resolveAgentContext(agentModuleId, firecrawlResult.markdown);
      const retrievalTimeMs = Date.now() - retrievalStartedAt;
      const moduleTags = agentContext.tags || [];
      const retrievalDiagnostics = agentContext.retrievalDiagnostics;
      const retrievalDiagnosticsSummary = retrievalDiagnostics
        ? ` | Embeddings: ${retrievalDiagnostics.indexedChunksCount}/${retrievalDiagnostics.activeChunksCount} | Sem vetor: ${retrievalDiagnostics.missingEmbeddingCount} | Dimensão inválida: ${retrievalDiagnostics.invalidDimensionCount} | Modelo diferente: ${retrievalDiagnostics.modelMismatchCount} | Metadado ausente: ${retrievalDiagnostics.missingModelMetadataCount} | Norma-pai ausente: ${retrievalDiagnostics.missingNormParentCount} | Esperado: ${retrievalDiagnostics.expectedEmbeddingModel}`
        : '';
      const allFilesAndNorms = agentContext.activeNorms.map(
        (n) => `${n.normCode}${n.article ? ` (${n.article})` : ''}: ${n.title}`
      );
      const normsFilesNames = agentContext.resolvedDbNorms?.map((n) => n.normCode || n.title) || [];
      const combinedNormsList = Array.from(new Set([...allFilesAndNorms, ...normsFilesNames]));

      // C05: Snapshot estruturado das normas vigentes utilizadas na auditoria
      const normsSnapshotJson = NormsResolver.createNormsSnapshot(
        agentContext.resolvedDbNorms && agentContext.resolvedDbNorms.length > 0
          ? agentContext.resolvedDbNorms
          : agentContext.activeNorms.map((n) => ({
              id: n.id,
              normCode: n.normCode,
              source: n.source,
              title: n.title,
              content: n.content,
              tags: n.keywords,
              article: n.article,
            }))
      );

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
            databaseNormsCount: agentContext.retrievalSource?.startsWith('MongoDB')
              ? agentContext.resolvedDbNorms?.length || 0
              : 0,
            retrievalStatus: agentContext.retrievalStatus,
            retrievalTimeMs,
            retrievalCandidatesCount: agentContext.retrievalCandidatesCount || 0,
            retrievalDiagnostics: agentContext.retrievalDiagnostics || null,
            retrievedChunks: (agentContext.resolvedDbNorms || []).map((norm) => ({
              code: norm.normCode,
              article: norm.article,
              score: norm.relevanceScore,
            })),
            sources: agentContext.retrievalSource
              ? [agentContext.retrievalSource]
              : ['Nenhum contexto normativo recuperado'],
          }),
        },
      }).catch(() => {});

      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'AI_ENGINE',
          correlationId,
          message: combinedNormsList.length > 0
            ? `[AI_INVOCATION] Invocando IA com Skill: "${effectiveSkill}" | Contexto com ${combinedNormsList.length} normas ativas para tags: [${moduleTags.join(', ')}]`
            : `[AI_INVOCATION_SKIPPED] IA não chamada: recuperação ${agentContext.retrievalStatus || 'NO_MATCH'} para tags [${moduleTags.join(', ')}] | Candidatos: ${agentContext.retrievalCandidatesCount || 0}${retrievalDiagnosticsSummary} | Ação: ${agentContext.retrievalStatus === 'UNINDEXED' ? 'executar npm run rag:reindex na base da aplicação e repetir a auditoria' : 'verificar as tags e a disponibilidade das normas vigentes'}`,
        },
      }).catch(() => {});

      // Adaptador para o formato do ReconciliationEngine
      const extractedEntities = ScraperService.extractEntities(
        firecrawlResult.markdown,
        firecrawlResult.rawContent || firecrawlResult.markdown
      );
      const rawLength = (firecrawlResult.rawContent || firecrawlResult.markdown).length;
      const cleanLength = firecrawlResult.markdown.length;
      const scrapeAdapter: ScrapeResult = {
        url: targetUrl,
        title: mod?.name || clientName,
        mode: params.extractionMode || ExtractionMode.FIRECRAWL,
        rawHtmlLength: rawLength,
        cleanMarkdown: firecrawlResult.markdown,
        tokensEstimatedRaw: Math.ceil(rawLength / 3),
        tokensEstimatedClean: Math.ceil(cleanLength / 4),
        tokensSavedPercentage: rawLength > 0 ? Math.max(0, ((rawLength - cleanLength) / rawLength) * 100) : 0,
        detectedTags: moduleTags,
        extractedEntities,
      };

      // 5. Invocação da IA e Reconciliação Deontológica
      const recon = await ReconciliationEngine.reconcile(scrapeAdapter, agentModuleId, agentContext);
      const executionTimeMs = Date.now() - startTime;

      // Telemetria e log de IA com tokens e fontes/normas utilizadas
      const aiInvocationSkipped = recon.aiModelUsed.startsWith('retrieval:');
      const retrievalStatus = agentContext.retrievalStatus || 'NO_MATCH';
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'AI_ENGINE',
          correlationId,
          message: aiInvocationSkipped
            ? `[AI_INVOCATION_SKIPPED] Auditoria ${recon.verdict}: provedor de IA não chamado | Status da recuperação: ${retrievalStatus} | Prompt Tokens: 0 | Completion Tokens: 0 | Total Tokens: 0 | Chunks candidatos: ${agentContext.retrievalCandidatesCount || 0}${retrievalDiagnosticsSummary}`
            : `[AI_INTERACTION] Veredito emitido: ${recon.verdict} (Score: ${recon.score}) | Prompt Tokens: ${recon.promptTokens} | Completion Tokens: ${recon.completionTokens} | Total Tokens: ${recon.totalTokens} | Latência: ${executionTimeMs}ms | Normas Aplicadas: ${recon.sourcesUsed.length}`,
          details: JSON.stringify({
            aiModelUsed: recon.aiModelUsed,
            aiInvoked: !aiInvocationSkipped,
            retrievalStatus,
            retrievalCandidatesCount: agentContext.retrievalCandidatesCount || 0,
            retrievalDiagnostics: agentContext.retrievalDiagnostics || null,
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
      const effectiveVerdict = (structuredContract.verdict as any) || recon.verdict;
      const requiresHumanReview = structuredContract.findings.some((f) => f.requires_human_review) || effectiveVerdict === 'INCONCLUSIVO';

      // 6. Persistência Transacional no MongoDB (AuditReport e Violations)
      await prisma.$transaction(async (tx) => {
        await tx.auditReport.update({
          where: { id: auditReportId },
          data: {
            status: 'COMPLETED',
            verdict: effectiveVerdict,
            score: recon.score,
            summary: recon.summary,
            riskLevel: structuredContract.risk_level,
            confidence: structuredContract.confidence,
            structuredContract: JSON.stringify(structuredContract),
            groundingScore: recon.groundingScore ?? null,
            hallucinationRisk: recon.hallucinationRisk ?? 'NOT_EVALUATED',
            guardrailsApplied: recon.guardrailsApplied ?? false,
            requiresHumanReview,
            normSnapshots: normsSnapshotJson,
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

      // 7. Notificação por E-mail do Laudo Concluído para a Clínica (Resend Email API & Telemetria)
      const resolvedEmails: string[] = [];
      if (client?.email && client.email.trim().length > 0) {
        resolvedEmails.push(client.email.trim());
      }
      if (client?.users && client.users.length > 0) {
        for (const u of client.users) {
          if (u.email && u.email.trim().length > 0 && !resolvedEmails.includes(u.email.trim())) {
            resolvedEmails.push(u.email.trim());
          }
        }
      }

      if (resolvedEmails.length === 0) {
        console.warn(`⚠️ [AuditExecutionService] Nenhum e-mail de destinatário encontrado para a clínica "${clientName}" (Cliente ID: ${finalClientId || 'N/A'}).`);
        await prisma.systemLog.create({
          data: {
            level: 'WARN',
            module: 'EMAIL_NOTIFICATION',
            correlationId,
            message: `[EMAIL_WARN] Nenhum endereço de e-mail válido encontrado para a clínica "${clientName}". Notificação não enviada.`,
            details: JSON.stringify({
              auditReportId,
              clientId: finalClientId,
              clientName,
              targetUrl,
              score: recon.score,
              verdict: recon.verdict,
            }),
          },
        }).catch(() => {});
      } else {
        for (const recipientEmail of resolvedEmails) {
          try {
            const emailResult = await EmailService.sendAuditReportCompletedEmail(recipientEmail, clientName, {
              id: auditReportId,
              targetUrl,
              score: recon.score,
              verdict: recon.verdict,
              summary: recon.summary,
              violationsCount: recon.violations.length,
            });

            if (emailResult.success) {
              await prisma.systemLog.create({
                data: {
                  level: 'INFO',
                  module: 'EMAIL_NOTIFICATION',
                  correlationId,
                  message: `[EMAIL_SUCCESS] E-mail de conclusão de laudo enviado com sucesso para ${recipientEmail} (Clínica: ${clientName}) | MessageId: ${emailResult.messageId || 'MOCK'} | Veredito: ${recon.verdict}`,
                  details: JSON.stringify({
                    auditReportId,
                    clientId: finalClientId,
                    clientName,
                    recipientEmail,
                    messageId: emailResult.messageId,
                    mocked: emailResult.mocked || false,
                    score: recon.score,
                    verdict: recon.verdict,
                  }),
                },
              }).catch(() => {});
            } else {
              console.error(`❌ [AuditExecutionService] Falha ao enviar e-mail de laudo para ${recipientEmail}: ${emailResult.error}`);
              await prisma.systemLog.create({
                data: {
                  level: 'WARN',
                  module: 'EMAIL_NOTIFICATION',
                  correlationId,
                  message: `[EMAIL_WARN] Falha ao enviar notificação de laudo por e-mail para "${recipientEmail}" (Clínica: "${clientName}"): ${emailResult.error || 'Erro na API de e-mail'}`,
                  details: JSON.stringify({
                    auditReportId,
                    clientId: finalClientId,
                    clientName,
                    recipientEmail,
                    error: emailResult.error,
                    score: recon.score,
                    verdict: recon.verdict,
                    targetUrl,
                  }),
                },
              }).catch(() => {});
            }
          } catch (emailErr: any) {
            console.error(`❌ [AuditExecutionService] Exceção ao enviar notificação de laudo para ${recipientEmail}: ${emailErr.message}`);
            await prisma.systemLog.create({
              data: {
                level: 'ERROR',
                module: 'EMAIL_NOTIFICATION',
                correlationId,
                message: `[EMAIL_ERROR] Erro inesperado durante o disparo de e-mail do laudo para "${recipientEmail}": ${emailErr.message}`,
                details: JSON.stringify({
                  auditReportId,
                  clientId: finalClientId,
                  clientName,
                  recipientEmail,
                  error: emailErr.message,
                  stack: emailErr.stack,
                }),
              },
            }).catch(() => {});
          }
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
