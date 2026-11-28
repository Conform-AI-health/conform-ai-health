import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { FirecrawlService } from './firecrawlService.js';
import { ReconciliationEngine } from './reconciliationEngine.js';
import { NormsResolver } from './normsResolver.js';
import { AIStructuredContractAdapter } from '../shared/aiStructuredContract.js';
import { ExtractionMode } from '@prisma/client';
import { ScraperService, ScrapeResult } from './scraperService.js';
import { decryptSecret, isMaskedSecret } from '../shared/encryption.js';
import { createLogger } from '../shared/logger.js';
import { getActiveTraceIds, runWithContext, withSpan } from '../shared/tracing.js';
import {
  extractMarkdownHeadingTitle,
  formatResolvedClientName,
  resolveClientByIdOrUrl,
} from '../shared/clientIdentityResolver.js';

const auditExecLog = createLogger('AuditExecutionService');

export interface ExecuteAuditParams {
  auditReportId: string;
  clientId: string;
  targetUrl: string;
  agentModuleId?: string;
  skill?: string;
  extractionMode?: ExtractionMode;
  jobId?: string | number;
  auth?: {
    hasAuth?: boolean;
    username?: string;
    password?: string;
  };
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
    reviewStatus?: string;
    auditorReviewed?: boolean;
    emailSent?: boolean;
  }> {
    const { auditReportId, clientId, targetUrl, agentModuleId, jobId } = params;
    const startTime = Date.now();
    const correlationId = auditReportId;

    return await runWithContext(
      {
        auditReportId,
        clientId: clientId || undefined,
        jobId: jobId ? String(jobId) : undefined,
      },
      async () =>
        await withSpan(
          'audit.execute',
          {
            'audit.report_id': auditReportId,
            'tenant.client_id': clientId || undefined,
            'app.version': env.APP_VERSION,
          },
          async () => {
            auditExecLog.info(
              { auditReportId, targetUrl, jobId: jobId || 'direct' },
              'Iniciando pipeline de auditoria'
            );

            try {
      // 1. Marca o laudo como RUNNING e recupera vínculo de cliente existente
      const updatedReport = await prisma.auditReport.update({
        where: { id: auditReportId },
        data: { status: 'RUNNING' },
        select: { clientId: true, targetUrl: true },
      }).catch(() => null);

      const effectiveTargetUrl = targetUrl || updatedReport?.targetUrl || '';
      const effectiveClientId = clientId || updatedReport?.clientId;

      // Recupera dados do módulo para contexto (por ID/code ou fallback por URL alvo)
      const mod = agentModuleId
        ? await prisma.agentModule.findFirst({
            where: { OR: [{ id: agentModuleId }, { code: agentModuleId }] },
          }).catch(() => null)
        : effectiveTargetUrl && prisma.agentModule?.findFirst
        ? await prisma.agentModule.findFirst({
            where: { targetUrl: effectiveTargetUrl },
          }).catch(() => null)
        : null;

      let client = await resolveClientByIdOrUrl({
        clientId: effectiveClientId || mod?.clientId,
        targetUrl: effectiveTargetUrl,
        moduleName: mod?.name,
        includeUsers: true,
      });

      let finalClientId = client?.id || effectiveClientId || mod?.clientId || undefined;

      // Se o módulo estava com clientId defasado (ex.: reaproveitado de outra clínica), corrige o vínculo no módulo
      if (mod?.id && client?.id && mod.clientId !== client.id && prisma.agentModule?.update) {
        await Promise.resolve(
          prisma.agentModule.update({
            where: { id: mod.id },
            data: { clientId: client.id },
          })
        ).catch(() => {});
      }

      let clientName = formatResolvedClientName({
        client,
        moduleName: mod?.name,
        targetUrl: effectiveTargetUrl,
      });
      const moduleName = mod?.name || 'Módulo Geral';
      const effectiveSkill = params.skill || mod?.description || 'compliance-specialist';

      // Determina configuração de autenticação (passada explicitamente ou recuperada do módulo, protegendo contra máscara '••••••••')
      const modDecryptedPwd = mod?.authPassword ? decryptSecret(mod.authPassword) || undefined : undefined;
      const validModPwd = modDecryptedPwd && !isMaskedSecret(modDecryptedPwd) ? modDecryptedPwd : undefined;
      const paramPwd =
        params.auth?.password && !isMaskedSecret(params.auth.password)
          ? params.auth.password
          : undefined;
      const hasAuthEnabled = Boolean(
        params.auth?.hasAuth ||
          params.auth?.username ||
          params.auth?.password ||
          mod?.hasAuth
      );
      const authConfig = hasAuthEnabled
        ? {
            hasAuth: true,
            username: params.auth?.username || mod?.authUsername || undefined,
            password: paramPwd || validModPwd,
          }
        : undefined;

      if (authConfig?.hasAuth) {
        if (!authConfig.username || !authConfig.password) {
          await prisma.systemLog.create({
            data: {
              level: 'WARN',
              module: 'SCRAPER',
              correlationId,
              message: `⚠️ [SCRAPER] [AUTH_CREDENTIALS_MISSING] Autenticação habilitada para ${targetUrl}, porém a senha válida não está disponível (ausente ou mascarada no banco). Redigite e salve a senha real do módulo no Cockpit.`,
            },
          }).catch(() => {});
        } else {
          await prisma.systemLog.create({
            data: {
              level: 'INFO',
              module: 'SCRAPER',
              correlationId,
              message: `[SCRAPER] [AUTH] Extração configurada com credenciais de autenticação para: ${targetUrl} (Usuário: ${authConfig.username || 'autenticado'})`,
            },
          }).catch(() => {});
        }
      }

      // Log operacional: Início da extração
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'SCRAPER',
          correlationId,
          message: `[SCRAPER] [FIRECRAWL] Acionando extração de página via Firecrawl para: ${targetUrl} (Cliente: ${clientName})${authConfig?.hasAuth ? ' [COM AUTENTICAÇÃO]' : ''}`,
        },
      }).catch(() => {});

      // 2 & 3. Scraping Exclusivo via Firecrawl + Hash SHA-256 + MongoDB
      const firecrawlResult = await withSpan(
        'audit.scrape',
        {
          'audit.report_id': auditReportId,
          'http.url': targetUrl,
          'audit.agent_module_id': agentModuleId,
        },
        async () => await FirecrawlService.scrape(targetUrl, agentModuleId, finalClientId, authConfig)
      );

      // T04: Validação estrita de integridade do conteúdo extraído
      if (!firecrawlResult || !firecrawlResult.markdown || firecrawlResult.markdown.trim().length === 0) {
        throw new Error('Conteúdo extraído vazio ou inexistente. Auditoria deontológica abortada para evitar geração de laudo inconsequente.');
      }

      if (!client && firecrawlResult.clientId) {
        client = await resolveClientByIdOrUrl({
          clientId: firecrawlResult.clientId,
          targetUrl: effectiveTargetUrl,
          moduleName: mod?.name,
          includeUsers: true,
        });
        if (client?.id) {
          finalClientId = client.id;
        }
      }
      clientName = formatResolvedClientName({
        client,
        moduleName: mod?.name,
        scrapedTitle: extractMarkdownHeadingTitle(firecrawlResult.markdown),
        targetUrl: effectiveTargetUrl,
      });

      // Telemetria forense: Registra êxito ou falha de login / acesso restrito
      if (authConfig?.hasAuth && firecrawlResult.authSuccess) {
        await prisma.systemLog.create({
          data: {
            level: 'INFO',
            module: 'SCRAPER',
            correlationId,
            message: `[SCRAPER] [AUTH_SUCCESS] Login na página efetuado com sucesso: sessão autorizada confirmada e conteúdo restrito extraído (${firecrawlResult.markdown.length} caracteres) para ${targetUrl} (Usuário: ${authConfig.username || 'autenticado'})`,
            details: JSON.stringify({
              url: targetUrl,
              username: authConfig.username,
              source: firecrawlResult.source,
              loginDetected: firecrawlResult.loginDetected ?? true,
              charsExtracted: firecrawlResult.markdown.length,
              tokensCount: firecrawlResult.tokensCount,
              contentHash: firecrawlResult.contentHash,
              timestamp: new Date().toISOString(),
            }),
          },
        }).catch(() => {});
      } else if (authConfig?.hasAuth && firecrawlResult.loginDetected && !firecrawlResult.authSuccess) {
        await prisma.systemLog.create({
          data: {
            level: 'WARN',
            module: 'SCRAPER',
            correlationId,
            message: `⚠️ [SCRAPER] [AUTH_FAILED] Formulário de login detectado em ${targetUrl}, mas a sessão autenticada não pôde ser estabelecida para o usuário "${authConfig.username || 'informado'}". Verifique usuário e senha do módulo.`,
          },
        }).catch(() => {});
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

      // 4. Detecção e Adição de Tags a partir do Scrap da URL Alvo Oficial para Otimização de Busca dos Chunks
      const scrapedPageTags = ScraperService.detectRegulatoryTags(firecrawlResult.markdown, '');
      const rawModuleTags = (mod?.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean);
      const combinedAuditTags = Array.from(new Set([
        ...rawModuleTags,
        ...scrapedPageTags.map((t) => t.trim().toLowerCase()),
        ...(firecrawlResult.tags || []).map((t) => t.trim().toLowerCase()).filter((t) => !['client_scrape', 'audit_asset'].includes(t)),
      ]));

      const newlyDiscoveredTags = combinedAuditTags.filter((t) => !rawModuleTags.includes(t));

      // Atualiza o módulo de agente no banco se novas tags forem detectadas no canal digital auditado
      if (newlyDiscoveredTags.length > 0 && mod?.id && prisma.agentModule?.update) {
        await Promise.resolve(
          prisma.agentModule.update({
            where: { id: mod.id },
            data: {
              tags: combinedAuditTags,
              rulesCount: combinedAuditTags.length * 4,
            },
          })
        ).catch(() => {});
      }

      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'SCRAPER',
          correlationId,
          message: `🏷️ [SCRAPER] [AUTO_TAGGING] Tags adicionadas após scraping da URL Alvo: [${scrapedPageTags.join(', ')}] | Escopo otimizado para busca de chunks: [${combinedAuditTags.join(', ')}]${newlyDiscoveredTags.length > 0 ? ` (+${newlyDiscoveredTags.length} novas tags vinculadas ao módulo)` : ''}`,
          details: JSON.stringify({
            url: targetUrl,
            configuredModuleTags: rawModuleTags,
            scrapedPageTags,
            newlyDiscoveredTags,
            effectiveAuditTags: combinedAuditTags,
            timestamp: new Date().toISOString(),
          }),
        },
      }).catch(() => {});

      // 5. Resolução Dinâmica de Normas no Banco de Dados através das Tags Otimizadas
      const retrievalStartedAt = Date.now();
      const agentContext = await ReconciliationEngine.resolveAgentContext(
        agentModuleId,
        firecrawlResult.markdown,
        combinedAuditTags,
        mod ? { ...mod, tags: combinedAuditTags } : undefined
      );
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

      // 5. Invocação da IA e Reconciliação Deontológica (com Cache Inteligente por Skill + Conteúdo + Normas)
      const reconMeta =
        typeof (ReconciliationEngine as any).reconcileWithCacheMeta === 'function'
          ? await withSpan(
              'audit.reconcile',
              {
                'audit.report_id': auditReportId,
                'tenant.client_id': finalClientId || undefined,
                'audit.norms_count': combinedNormsList.length,
              },
              async () =>
                await ReconciliationEngine.reconcileWithCacheMeta(
                  scrapeAdapter,
                  agentModuleId,
                  agentContext
                )
            )
          : {
              output: await withSpan(
                'audit.reconcile',
                {
                  'audit.report_id': auditReportId,
                  'tenant.client_id': finalClientId || undefined,
                  'audit.norms_count': combinedNormsList.length,
                },
                async () => await ReconciliationEngine.reconcile(scrapeAdapter, agentModuleId, agentContext)
              ),
              cacheHit: false,
              cacheKey: undefined as string | undefined,
              evictedPreviousKey: undefined as string | undefined,
              evictionReason: undefined as string | undefined,
              tokensSavedByCache: 0,
            };

      const recon = reconMeta.output;

      const invocationMessage =
        combinedNormsList.length === 0
          ? `[AI_INVOCATION_SKIPPED] IA não chamada: recuperação ${agentContext.retrievalStatus || 'NO_MATCH'} para tags [${moduleTags.join(', ')}] | Candidatos: ${agentContext.retrievalCandidatesCount || 0}${retrievalDiagnosticsSummary} | Ação: ${agentContext.retrievalStatus === 'UNINDEXED' ? 'executar npm run rag:reindex na base da aplicação e repetir a auditoria' : 'verificar as tags e a disponibilidade das normas vigentes'}`
          : reconMeta.cacheHit
          ? `⚡ [AI_INVOCATION] [CACHE_HIT] Resposta recuperada do cache para Skill: "${effectiveSkill}" | Contexto e conteúdo inalterados (${reconMeta.tokensSavedByCache} tokens economizados) | ${combinedNormsList.length} normas ativas para tags: [${moduleTags.join(', ')}]`
          : reconMeta.evictedPreviousKey || reconMeta.evictionReason
          ? `🔄 [AI_INVOCATION] [CACHE_INVALIDATED] Alteração detectada (${reconMeta.evictionReason || 'contexto_atualizado'}) — cache anterior removido. Invocando IA com Skill: "${effectiveSkill}" | Contexto com ${combinedNormsList.length} normas ativas para tags: [${moduleTags.join(', ')}]`
          : `[AI_INVOCATION] Invocando IA com Skill: "${effectiveSkill}" | Contexto com ${combinedNormsList.length} normas ativas para tags: [${moduleTags.join(', ')}]`;

      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'AI_ENGINE',
          correlationId,
          message: invocationMessage,
          details: JSON.stringify({
            cacheHit: reconMeta.cacheHit,
            cacheKey: reconMeta.cacheKey || null,
            evictedPreviousKey: reconMeta.evictedPreviousKey || null,
            evictionReason: reconMeta.evictionReason || null,
            tokensSavedByCache: reconMeta.tokensSavedByCache || 0,
            activeNormsCount: combinedNormsList.length,
            tags: moduleTags,
          }),
        },
      }).catch(() => {});

      const executionTimeMs = Date.now() - startTime;

      // Telemetria e log de IA com tokens e fontes/normas utilizadas
      const aiInvocationSkipped = recon.aiModelUsed.startsWith('retrieval:');
      const isHeuristicFallback = recon.aiModelUsed.startsWith('heuristic:fallback');
      const retrievalStatus = agentContext.retrievalStatus || 'NO_MATCH';

      let logMessage = reconMeta.cacheHit
        ? `⚡ [AI_INTERACTION] [CACHE_HIT] Veredito recuperado do cache: ${recon.verdict} (Score: ${recon.score}) | Prompt Tokens: 0 | Completion Tokens: 0 | Tokens Economizados: ${reconMeta.tokensSavedByCache} | Latência Total: ${executionTimeMs}ms | Normas Aplicadas: ${recon.sourcesUsed.length}`
        : `[AI_INTERACTION] Veredito emitido: ${recon.verdict} (Score: ${recon.score}) | Prompt Tokens: ${recon.promptTokens} | Completion Tokens: ${recon.completionTokens} | Total Tokens: ${recon.totalTokens} | Latência: ${executionTimeMs}ms | Normas Aplicadas: ${recon.sourcesUsed.length}`;
      let logLevel = 'INFO';

      if (aiInvocationSkipped) {
        logMessage = `[AI_INVOCATION_SKIPPED] Auditoria ${recon.verdict}: provedor de IA não chamado | Status da recuperação: ${retrievalStatus} | Prompt Tokens: 0 | Completion Tokens: 0 | Total Tokens: 0 | Chunks candidatos: ${agentContext.retrievalCandidatesCount || 0}${retrievalDiagnosticsSummary}`;
      } else if (isHeuristicFallback) {
        logLevel = 'WARN';
        logMessage = `⚠️ [AI_FALLBACK_TRIGGERED] Veredito contingencial: ${recon.verdict} (Score: ${recon.score}) | Provedor de IA indisponível (0 tokens) | Fallback Heurístico acionado | Latência: ${executionTimeMs}ms | Normas: ${recon.sourcesUsed.length}`;
      }

      await prisma.systemLog.create({
        data: {
          level: logLevel,
          module: 'AI_ENGINE',
          correlationId,
          message: logMessage,
          details: JSON.stringify({
            aiModelUsed: recon.aiModelUsed,
            aiInvoked: !aiInvocationSkipped && !reconMeta.cacheHit,
            cacheHit: reconMeta.cacheHit,
            tokensSavedByCache: reconMeta.tokensSavedByCache || 0,
            heuristicFallback: isHeuristicFallback,
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
            summary: recon.summary,
          }),
        },
      }).catch(() => {});

      // Gera Contrato Estruturado de Alta Confiabilidade
      const structuredContract = AIStructuredContractAdapter.toStructuredContract(recon, auditReportId);
      const effectiveVerdict = (structuredContract.verdict as any) || recon.verdict;
      const requiresHumanReview = structuredContract.findings.some((f) => f.requires_human_review) || effectiveVerdict === 'INCONCLUSIVO';

      // 6. Persistência Transacional no MongoDB (AuditReport e Violations)
      await withSpan(
        'audit.persist_report',
        {
          'audit.report_id': auditReportId,
          'audit.verdict': String(effectiveVerdict),
          'audit.violations_count': recon.violations.length,
        },
        async () =>
          await prisma.$transaction(async (tx) => {
            await tx.auditReport.update({
              where: { id: auditReportId },
              data: {
                ...(finalClientId ? { clientId: finalClientId } : {}),
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
                requiresHumanReview: true,
                reviewStatus: 'PENDING_REVIEW',
                auditorReviewed: false,
                emailSent: false,
                normSnapshots: normsSnapshotJson,
                rawContent: firecrawlResult.rawContent,
                cleanMarkdown: firecrawlResult.markdown,
                tokensSaved:
                  Math.max(0, scrapeAdapter.tokensEstimatedRaw - scrapeAdapter.tokensEstimatedClean) +
                  (reconMeta.tokensSavedByCache || 0),
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
          })
      );

      const { traceId } = getActiveTraceIds();

      // Log de sucesso com telemetria de guardrails
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'RECONCILIATION',
          correlationId,
          message: `[RECONCILIATION] Auditoria concluída com sucesso para "${clientName}" | ${recon.violations.length} infrações detectadas | Grounding: ${recon.groundingScore ?? 100}% | Status: COMPLETED | Tempo: ${executionTimeMs}ms`,
          details: JSON.stringify({
            auditReportId,
            traceId,
            appVersion: env.APP_VERSION,
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

      // 7. Fluxo de Governança e Revisão do Auditor (HITL - Human-in-the-Loop)
      // O laudo concluído pela IA é encaminhado para o Cockpit / Menu "Revisão de Laudos".
      // O e-mail para a clínica NÃO é disparado automaticamente; aguarda revisão e confirmação do auditor.
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'AUDIT_WORKFLOW',
          correlationId,
          message: `[AUDIT_AWAITING_REVIEW] Laudo ${auditReportId} gerado pela IA com sucesso. Encaminhado para a fila de Revisão & Confirmação do Auditor (Menu Revisão de Laudos) antes do envio do e-mail oficial à clínica "${clientName}".`,
          details: JSON.stringify({
            auditReportId,
            traceId,
            appVersion: env.APP_VERSION,
            clientId: finalClientId,
            clientName,
            targetUrl,
            score: recon.score,
            verdict: recon.verdict,
            reviewStatus: 'PENDING_REVIEW',
            auditorReviewed: false,
            emailSent: false,
          }),
        },
      }).catch(() => {});

      auditExecLog.info(
        { auditReportId, executionTimeMs, verdict: recon.verdict, score: recon.score },
        'Auditoria concluída pela IA. Aguardando revisão do auditor na fila de governança'
      );

      return {
        success: true,
        auditReportId,
        verdict: recon.verdict,
        score: recon.score,
        violationsCount: recon.violations.length,
        reviewStatus: 'PENDING_REVIEW',
        auditorReviewed: false,
        emailSent: false,
      };
    } catch (error: any) {
      auditExecLog.error({ auditReportId, err: error }, 'Falha na execução da auditoria');

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
        )
    );
  }
}
