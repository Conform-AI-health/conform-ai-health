import { RuleSeverity } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { NormChunk } from '../data/normsCatalog.js';
import { ScrapeResult } from './scraperService.js';
import { NormsResolver } from './normsResolver.js';
import { SemanticEmbeddingService } from './semanticEmbeddingService.js';
import { CircuitBreaker } from '../shared/circuitBreaker.js';
import { Bulkhead } from '../shared/bulkhead.js';
import { AIGuardrails } from '../shared/aiGuardrails.js';
import { AIStructuredContractAdapter, StructuredAuditContract } from '../shared/aiStructuredContract.js';
import { AIProviderFactory } from './ai/aiProviderFactory.js';
import { HeuristicProvider } from './ai/heuristicProvider.js';
import {
  violationSchema,
  reconciliationOutputSchema,
  ReconciliationOutput,
  AgentContext,
} from '../shared/reconciliationTypes.js';

export {
  violationSchema,
  reconciliationOutputSchema,
  ReconciliationOutput,
  AgentContext,
};

function toNormChunks(norms: Awaited<ReturnType<typeof NormsResolver.retrieveRelevantByTags>>['norms']): NormChunk[] {
  return norms.map((norm) => ({
    id: norm.id,
    normCode: norm.normCode,
    source: norm.source || 'REGULATORIO',
    title: norm.title,
    article: norm.article || 'Dispositivo Geral',
    severityDefault: (norm.severityDefault || 'MEDIA') as RuleSeverity,
    keywords: norm.tags,
    content: norm.content,
    correctiveGuidance: `Adequar conforme as diretrizes regulatórias vigentes da norma ${norm.normCode}.`,
    validity: {
      publishedAt: '2023-01-01',
      effectiveDate: '2023-01-01',
      revokedAt: null,
      isRevoked: false,
      officialGazette: 'Diário Oficial da União',
    },
  }));
}

export class ReconciliationEngine {
  public static get geminiCircuitBreaker(): CircuitBreaker {
    return AIProviderFactory.getProvider('gemini').getCircuitBreaker();
  }
  public static get ollamaCircuitBreaker(): CircuitBreaker {
    return AIProviderFactory.getProvider('ollama').getCircuitBreaker();
  }
  public static get aiBulkhead(): Bulkhead {
    return AIProviderFactory.aiBulkhead;
  }

  public static invalidateModelCache(): void {
    AIProviderFactory.invalidateModelCache();
  }

  public static async getActiveModelConfig() {
    return await AIProviderFactory.getActiveModelConfig();
  }

  public static getActiveProvider(): string {
    return AIProviderFactory.getActiveProviderName();
  }

  public static setActiveProvider(provider: 'gemini' | 'ollama' | 'heuristic'): void {
    AIProviderFactory.setActiveProvider(provider);
  }

  public static async testModelResponse(customPrompt?: string, targetModelId?: string): Promise<{
    provider: string;
    model: string;
    status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
    latencyMs: number;
    response: string;
    testedAt: string;
    details?: any;
  }> {
    return await AIProviderFactory.testModelResponse(customPrompt, targetModelId);
  }

  public static async resolveAgentContext(agentModuleId?: string, queryText?: string): Promise<AgentContext> {
    if (agentModuleId) {
      const agent = await prisma.agentModule.findFirst({
        where: { OR: [{ id: agentModuleId }, { code: agentModuleId }] },
      });
      if (!agent) {
        throw new Error(`Módulo de auditoria "${agentModuleId}" não encontrado.`);
      }

      const agentTags = Array.from(new Set([
        ...(agent.tags || []),
        ...(agent.targetNorms || []),
      ].map((tag) => tag.trim()).filter(Boolean)));
      const retrieval = queryText
        ? await NormsResolver.retrieveRelevantByTags(agentTags, queryText)
        : {
            norms: [],
            status: agentTags.length > 0 ? 'NO_QUERY' as const : 'NO_SCOPE' as const,
            candidatesCount: 0,
            source: undefined,
            diagnostics: undefined,
          };
      const agentSkill = agent.description?.trim() ||
        `Auditor Deontológico em Saúde especialista em conformidade com as resoluções vigentes de ${agentTags.join(', ')}.`;
      const defaultPrompt = `Você é o agente especialista "${agent.name}" (${agent.code || 'MODULO'}).
Skill Comportamental e Escopo do Agente: ${agentSkill}.
Tags Regulatórias: ${agentTags.join(', ')}.
Marco Regulatório Auditado: ${agent.regulatoryFramework || 'Conformidade e Deontologia em Saúde'}.
Audite somente com base nos dispositivos normativos recuperados para esta página.
Normas ou artigos revogados nunca devem fundamentar uma infração.
Use exclusivamente a seção "NORMAS RECUPERADAS" fornecida no contexto da auditoria.`;
      const rawPrompt = agent.systemPrompt?.trim() || defaultPrompt;
      const systemPrompt = rawPrompt.replace(
        /\{normasVigentesDoEscopo\}/g,
        'As normas são fornecidas uma única vez na seção "NORMAS RECUPERADAS" do contexto.'
      );

      return {
        id: agent.id,
        name: agent.name,
        code: agent.code || undefined,
        description: agent.description || undefined,
        skill: agentSkill,
        regulatoryFramework: agent.regulatoryFramework || undefined,
        systemPrompt,
        targetNorms: agent.targetNorms || [],
        tags: agentTags,
        activeNorms: toNormChunks(retrieval.norms),
        resolvedDbNorms: retrieval.norms,
        retrievalStatus: retrieval.status,
        retrievalSource: retrieval.source,
        retrievalCandidatesCount: retrieval.candidatesCount,
        retrievalDiagnostics: retrieval.diagnostics,
      };
    }

    const defaultAgent = await prisma.agentDefinition.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    const defaultTags = defaultAgent?.targetNorm ? [defaultAgent.targetNorm] : [];
    const retrieval = queryText
      ? await NormsResolver.retrieveRelevantByTags(defaultTags, queryText)
      : {
          norms: [],
          status: defaultTags.length > 0 ? 'NO_QUERY' as const : 'NO_SCOPE' as const,
          candidatesCount: 0,
          source: undefined,
          diagnostics: undefined,
        };

    return {
      name: defaultAgent?.name || 'Auditor Deontológico ConformIA',
      systemPrompt: defaultAgent?.systemPrompt.trim() ||
        'Audite somente com base nos dispositivos normativos recuperados para esta página. Na ausência deles, não conclua conformidade.',
      targetNorms: defaultTags,
      tags: defaultTags,
      activeNorms: toNormChunks(retrieval.norms),
      resolvedDbNorms: retrieval.norms,
      retrievalStatus: retrieval.status,
      retrievalSource: retrieval.source,
      retrievalCandidatesCount: retrieval.candidatesCount,
      retrievalDiagnostics: retrieval.diagnostics,
    };
  }

  public static async resolveAgentSystemPrompt(agentModuleId?: string): Promise<string> {
    const context = await this.resolveAgentContext(agentModuleId);
    return context.systemPrompt;
  }

  public static async reconcile(
    scrape: ScrapeResult,
    agentModuleId?: string,
    resolvedContext?: AgentContext
  ): Promise<ReconciliationOutput> {
    const agentContext = resolvedContext || await this.resolveAgentContext(agentModuleId, scrape.cleanMarkdown);
    if (agentContext.activeNorms.length === 0) {
      const retrievalStatus = agentContext.retrievalStatus || 'NO_MATCH';
      const diagnostics = agentContext.retrievalDiagnostics;
      const retrievalDetails = retrievalStatus === 'UNINDEXED'
        ? `A recuperação encontrou ${diagnostics?.indexedChunksCount || 0}/${diagnostics?.activeChunksCount || agentContext.retrievalCandidatesCount || 0} chunks indexados. Modelo esperado: "${diagnostics?.expectedEmbeddingModel || SemanticEmbeddingService.embeddingModelId}". Sem embedding: ${diagnostics?.missingEmbeddingCount || 0}; dimensão inválida: ${diagnostics?.invalidDimensionCount || 0}; modelo diferente: ${diagnostics?.modelMismatchCount || 0}; metadado ausente: ${diagnostics?.missingModelMetadataCount || 0}; norma-pai ausente: ${diagnostics?.missingNormParentCount || 0}. A IA não foi chamada (0 tokens). Gere os embeddings na mesma base usada pela aplicação e verifique a saída de \`npm run rag:reindex\`.`
        : `Nenhum chunk normativo utilizável foi recuperado para as tags [${(agentContext.tags || []).join(', ')}]. Status da recuperação: ${retrievalStatus}.`;
      return reconciliationOutputSchema.parse({
        verdict: 'INCONCLUSIVO',
        score: 60,
        summary: `Auditoria inconclusiva: ${retrievalDetails} Revisão humana obrigatória.`,
        violations: [],
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        sourcesUsed: [],
        aiModelUsed: `retrieval:${retrievalStatus}`,
        groundingScore: null,
        hallucinationRisk: 'NOT_EVALUATED',
        guardrailsApplied: true,
        hallucinationsInterceptedCount: 0,
      });
    }

    const activeModel = await this.getActiveModelConfig();
    console.log(`[ReconciliationEngine] Iniciando auditoria para ${scrape.url} usando modelo: ${activeModel.name} (${activeModel.provider})`);
    const rawOutput = await AIProviderFactory.reconcile(scrape, agentContext);

    const { sanitizedOutput } = await AIGuardrails.validateAndSanitizeOutput(
      rawOutput,
      scrape,
      agentContext.activeNorms
    );
    return sanitizedOutput;
  }

  public static async reconcileStructured(
    scrape: ScrapeResult,
    agentModuleId?: string,
    auditId?: string
  ): Promise<StructuredAuditContract> {
    const rawOutput = await this.reconcile(scrape, agentModuleId);
    return AIStructuredContractAdapter.toStructuredContract(rawOutput, auditId);
  }

  public static reconcileWithHeuristic(
    scrape: ScrapeResult,
    customSummaryHeader?: string,
    agentContext?: AgentContext
  ): ReconciliationOutput {
    const heuristic = AIProviderFactory.getProvider('heuristic') as HeuristicProvider;
    return heuristic.executeHeuristic(scrape, customSummaryHeader, agentContext);
  }
}
