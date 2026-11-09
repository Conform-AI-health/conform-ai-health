import { z } from 'zod';
import { RuleSeverity, Verdict } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { NORMS_CATALOG, NormChunk } from '../data/normsCatalog.js';
import { ScrapeResult } from './scraperService.js';
import { NormsResolver, ResolvedNorm } from './normsResolver.js';
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

export class ReconciliationEngine {
  // Padrão de Resiliência: Circuit Breakers e Bulkhead unificados na fábrica de provedores
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

  /**
   * Realiza teste pontual de integridade, latência e conectividade com o modelo ativo ou um modelo específico
   */
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

  /**
   * Resolve o contexto completo e soberano do agente a partir do banco de dados (MongoDB)
   */
  public static async resolveAgentContext(agentModuleId?: string): Promise<AgentContext> {
    if (agentModuleId) {
      try {
        const agent = await prisma.agentModule.findFirst({
          where: {
            OR: [{ id: agentModuleId }, { code: agentModuleId }],
          },
        });
        if (agent) {
          // Resolução dinâmica de normas no banco de dados através das tags do agente
          const agentTags = agent.tags && agent.tags.length > 0 ? agent.tags : ['CFM'];
          const dbNorms = await NormsResolver.resolveByTags(agentTags);

          let activeNorms: NormChunk[] = dbNorms
            .filter((n) => {
              const isRevogada = (n.tags || []).some(
                (t) => t.trim().toUpperCase() === 'REVOGADO' || t.trim().toUpperCase().includes('REVOGAD')
              );
              return !isRevogada;
            })
            .map((n) => ({
              id: n.id,
              normCode: n.normCode,
              source: (n.source as any) || 'CFM',
              title: n.title,
              article: n.article || 'Dispositivo Geral',
              severityDefault: (n.severityDefault as any) || 'MEDIA',
              keywords: n.tags,
              content: n.content,
              correctiveGuidance: `Adequar conforme as diretrizes regulatórias vigentes da norma ${n.normCode}.`,
            }));

          if (activeNorms.length === 0) {
            activeNorms = NORMS_CATALOG.filter((chunk) => {
              const isChunkRevogado =
                chunk.keywords.some((k) => k.toLowerCase().includes('revogad')) ||
                chunk.title.toLowerCase().includes('revogad');
              return !isChunkRevogado;
            });
          }

          // A Descrição e Escopo atua como a Skill comportamental e persona da IA
          const agentSkill =
            agent.description && agent.description.trim().length > 0
              ? agent.description.trim()
              : `Auditor Deontológico em Saúde especialista em conformidade com as resoluções vigentes de ${agentTags.join(', ')}.`;

          const systemPrompt = `Você é o agente especialista "${agent.name}" (${agent.code || 'MODULO'}).
Skill Comportamental e Escopo do Agente: ${agentSkill}.
Tags Regulatórias: ${agentTags.join(', ')}.
Marco Regulatório Auditado: ${agent.regulatoryFramework || 'Conformidade e Deontologia em Saúde'}.
Sua missão é realizar auditoria deontológica rigorosa confrontando o conteúdo do website com o rol integral de normas associadas.
DIRETRIZ DE VIGÊNCIA REGULATÓRIA: Normas, resoluções ou artigos revogados não possuem vigência jurídica e JAMAIS devem ser considerados como infração na auditoria deontológica imediata.`;

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
            activeNorms,
            resolvedDbNorms: dbNorms,
          };
        }
      } catch (err: any) {
        console.warn(`[ReconciliationEngine] Não foi possível carregar o agente ${agentModuleId}: ${err.message}`);
      }
    }

    // Busca na definição padrão de agente
    try {
      const defaultAgentDef = await prisma.agentDefinition.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      if (defaultAgentDef) {
        const targetNormLower = defaultAgentDef.targetNorm ? defaultAgentDef.targetNorm.toLowerCase() : '';
        const activeNorms = targetNormLower
          ? NORMS_CATALOG.filter(
              (n) =>
                n.source.toLowerCase().includes(targetNormLower) ||
                n.normCode.toLowerCase().includes(targetNormLower) ||
                n.id.toLowerCase().includes(targetNormLower)
            )
          : [...NORMS_CATALOG];

        return {
          name: defaultAgentDef.name,
          systemPrompt: defaultAgentDef.systemPrompt.trim(),
          targetNorms: defaultAgentDef.targetNorm ? [defaultAgentDef.targetNorm] : [],
          activeNorms: activeNorms.length > 0 ? activeNorms : [...NORMS_CATALOG],
        };
      }
    } catch {
      // Fallback seguro
    }

    return {
      name: 'Auditor Deontológico ConformIA',
      systemPrompt: `Você é o Auditor Deontológico em Saúde da ConformIA.
Sua missão é auditar o conteúdo de materiais médicos e confrontá-los com as normas regulatórias e deontológicas vigentes.`,
      targetNorms: ['CFM', 'LGPD', 'ANS', 'ANVISA'],
      activeNorms: [...NORMS_CATALOG],
    };
  }

  public static async resolveAgentSystemPrompt(agentModuleId?: string): Promise<string> {
    const context = await this.resolveAgentContext(agentModuleId);
    return context.systemPrompt;
  }

  /**
   * Executa a auditoria deontológica com cascata de resiliência e contexto dinâmico do agente
   * delegando aos provedores desacoplados via AIProviderFactory (Gemini, Ollama, Heurística)
   */
  public static async reconcile(scrape: ScrapeResult, agentModuleId?: string): Promise<ReconciliationOutput> {
    const activeModel = await this.getActiveModelConfig();
    console.log(`[ReconciliationEngine] Iniciando auditoria para ${scrape.url} usando modelo: ${activeModel.name} (${activeModel.provider})`);

    const agentContext = await this.resolveAgentContext(agentModuleId);
    const rawOutput = await AIProviderFactory.reconcile(scrape, agentContext);

    // Camada Obrigatória de Quality Gate: Guardrails Anti-Alucinação & Grounding Mandatório
    const { sanitizedOutput } = await AIGuardrails.validateAndSanitizeOutput(
      rawOutput,
      scrape,
      agentContext.activeNorms
    );

    return sanitizedOutput;
  }

  /**
   * Executa a reconciliação e retorna estritamente no Contrato Estruturado de Alta Confiabilidade
   * { audit_id, risk_level, confidence, findings: [ { description, regulation, article, evidence, source_version, recommendation, requires_human_review } ] }
   */
  public static async reconcileStructured(
    scrape: ScrapeResult,
    agentModuleId?: string,
    auditId?: string
  ): Promise<StructuredAuditContract> {
    const rawOutput = await this.reconcile(scrape, agentModuleId);
    return AIStructuredContractAdapter.toStructuredContract(rawOutput, auditId);
  }

  /**
   * Mecanismo determinístico de regras baseado estritamente no catálogo de normas vinculado ao agente
   */
  public static reconcileWithHeuristic(
    scrape: ScrapeResult,
    customSummaryHeader?: string,
    agentContext?: AgentContext
  ): ReconciliationOutput {
    const heuristic = AIProviderFactory.getProvider('heuristic') as HeuristicProvider;
    return heuristic.executeHeuristic(scrape, customSummaryHeader, agentContext);
  }
}
