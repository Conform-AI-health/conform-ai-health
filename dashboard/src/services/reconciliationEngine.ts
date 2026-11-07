import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import { z } from 'zod';
import { RuleSeverity, Verdict } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { NORMS_CATALOG, NormChunk } from '../data/normsCatalog.js';
import { ScrapeResult } from './scraperService.js';

export const violationSchema = z.object({
  normArticle: z.string().describe('Artigo e parágrafo específico violado'),
  normCode: z.string().describe('Código da norma (ex: Res. CFM 2.336/23, LGPD Art. 11)'),
  severity: z.enum(['LEVE', 'MEDIA', 'GRAVE', 'CRITICA']).describe('Nível de severidade da infração deontológica'),
  detectedText: z.string().describe('Trecho exato ou evidência detectada na página'),
  correctiveAdvice: z.string().describe('Recomendação prática e amigável para adequação regulatória'),
});

export const reconciliationOutputSchema = z.object({
  verdict: z.enum(['CONFORME', 'PARCIALMENTE_CONFORME', 'NAO_CONFORME']).describe('Veredito semáforo final'),
  score: z.number().min(0).max(100).describe('Pontuação de risco ou conformidade de 0 a 100'),
  summary: z.string().describe('Síntese diagnóstica da auditoria deontológica'),
  violations: z.array(violationSchema).describe('Lista de violações normativas identificadas'),
  promptTokens: z.number().default(0),
  completionTokens: z.number().default(0),
  totalTokens: z.number().default(0),
  sourcesUsed: z.array(z.string()).default([]),
  aiModelUsed: z.string().default('gemini-2.0-flash'),
});

export type ReconciliationOutput = z.infer<typeof reconciliationOutputSchema>;

export interface AgentContext {
  id?: string;
  name: string;
  code?: string | null;
  description?: string | null;
  regulatoryFramework?: string | null;
  systemPrompt: string;
  targetNorms: string[];
  activeNorms: NormChunk[];
}

export class ReconciliationEngine {
  private static activeProvider: 'gemini' | 'ollama' | 'heuristic' = (env.AI_PROVIDER as any) || 'gemini';
  private static cachedActiveModel: any = null;
  private static cacheTimestamp: number = 0;

  public static invalidateModelCache(): void {
    this.cachedActiveModel = null;
    this.cacheTimestamp = 0;
  }

  public static async getActiveModelConfig(): Promise<{
    id?: string;
    name: string;
    provider: 'gemini' | 'ollama' | 'heuristic';
    modelId: string;
    baseUrl?: string | null;
    apiKey?: string | null;
    temperature: number;
    maxTokens: number;
  }> {
    const now = Date.now();
    if (this.cachedActiveModel && now - this.cacheTimestamp < 30000) {
      return this.cachedActiveModel;
    }

    try {
      const activeFromDb = await prisma.aiModelConfig.findFirst({
        where: { isActive: true },
      });

      if (activeFromDb) {
        this.cachedActiveModel = {
          id: activeFromDb.id,
          name: activeFromDb.name,
          provider: activeFromDb.provider as any,
          modelId: activeFromDb.modelId,
          baseUrl: activeFromDb.baseUrl || env.OLLAMA_BASE_URL,
          apiKey: activeFromDb.apiKey || env.GEMINI_API_KEY,
          temperature: activeFromDb.temperature ?? 0.2,
          maxTokens: activeFromDb.maxTokens ?? 2048,
        };
        this.activeProvider = this.cachedActiveModel.provider;
        this.cacheTimestamp = now;
        return this.cachedActiveModel;
      }
    } catch {
      // Fallback em caso de banco inicializando
    }

    return {
      name:
        this.activeProvider === 'gemini'
          ? 'Google Gemini 2.0 Flash'
          : this.activeProvider === 'ollama'
          ? 'Ollama Local'
          : 'Motor Heurístico Deontológico',
      provider: this.activeProvider,
      modelId:
        this.activeProvider === 'gemini'
          ? 'gemini-2.0-flash'
          : this.activeProvider === 'ollama'
          ? env.OLLAMA_MODEL
          : 'regex-heuristic-v1',
      baseUrl: env.OLLAMA_BASE_URL,
      apiKey: env.GEMINI_API_KEY,
      temperature: 0.2,
      maxTokens: 2048,
    };
  }

  public static getActiveProvider(): string {
    return this.activeProvider;
  }

  public static setActiveProvider(provider: 'gemini' | 'ollama' | 'heuristic'): void {
    this.activeProvider = provider;
    this.invalidateModelCache();
    console.log(`[ReconciliationEngine] Provedor de IA alternado para: ${provider}`);
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
    const startTime = Date.now();
    let activeModel: any = null;
    if (targetModelId) {
      activeModel = await prisma.aiModelConfig.findUnique({ where: { id: targetModelId } }).catch(() => null);
    }
    if (!activeModel) {
      activeModel = await this.getActiveModelConfig();
    }
    const provider = activeModel.provider;
    const prompt =
      customPrompt ||
      'Teste de integridade Conform.AI: Confirme em uma frase sucinta a prontidão para auditoria deontológica da Resolução CFM 2.336/2023.';

    if (provider === 'gemini') {
      try {
        const apiKey = activeModel.apiKey || env.GEMINI_API_KEY;
        if (!apiKey || apiKey === 'mock-key-for-tests-and-dev') {
          return {
            provider: 'gemini',
            model: activeModel.modelId || 'gemini-2.0-flash',
            status: 'DEGRADED',
            latencyMs: Date.now() - startTime,
            response: 'Ambiente de teste/desenvolvimento: Chave GEMINI_API_KEY mockada. Operando em modo de simulação local.',
            testedAt: new Date().toISOString(),
          };
        }
        const ai = new GoogleGenAI({ apiKey });
        const res = await ai.models.generateContent({
          model: activeModel.modelId || 'gemini-2.0-flash',
          contents: prompt,
        });
        const latencyMs = Date.now() - startTime;
        return {
          provider: 'gemini',
          model: activeModel.modelId || 'gemini-2.0-flash',
          status: 'ONLINE',
          latencyMs,
          response: res.text || 'Modelo Gemini respondeu com sucesso ao teste deontológico.',
          testedAt: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: 'gemini',
          model: activeModel.modelId || 'gemini-2.0-flash',
          status: 'OFFLINE',
          latencyMs: Date.now() - startTime,
          response: `Falha na comunicação com o Gemini: ${err.message}`,
          testedAt: new Date().toISOString(),
          details: err.message,
        };
      }
    } else if (provider === 'ollama') {
      try {
        const ollamaUrl = activeModel.baseUrl || env.OLLAMA_BASE_URL || 'http://localhost:11434';
        const model = activeModel.modelId || env.OLLAMA_MODEL || 'qwen2.5:7b';
        const res = await axios.post(
          `${ollamaUrl}/api/generate`,
          {
            model,
            prompt,
            stream: false,
          },
          { timeout: 8000 }
        );
        const latencyMs = Date.now() - startTime;
        return {
          provider: 'ollama',
          model,
          status: 'ONLINE',
          latencyMs,
          response: res.data?.response || 'Modelo Ollama respondeu com sucesso.',
          testedAt: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: 'ollama',
          model: activeModel.modelId || 'qwen2.5:7b',
          status: 'OFFLINE',
          latencyMs: Date.now() - startTime,
          response: `Falha na comunicação com o Ollama Local: ${err.message}`,
          testedAt: new Date().toISOString(),
          details: err.message,
        };
      }
    } else {
      // Provedor Heurístico
      const latencyMs = Date.now() - startTime;
      return {
        provider: 'heuristic',
        model: activeModel.modelId || 'regex-heuristic-v1',
        status: 'ONLINE',
        latencyMs,
        response: 'Motor Heurístico Deontológico Operacional: Catálogo CFM 2.336/2023 e LGPD ativo em memória.',
        testedAt: new Date().toISOString(),
      };
    }
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
          // Filtragem dinâmica de normas vinculadas ao agente
          let activeNorms: NormChunk[] = [];
          if (agent.targetNorms && agent.targetNorms.length > 0) {
            const targetsLower = agent.targetNorms.map((t) => t.toLowerCase());
            activeNorms = NORMS_CATALOG.filter(
              (n) =>
                targetsLower.includes(n.id.toLowerCase()) ||
                targetsLower.includes(n.source.toLowerCase()) ||
                targetsLower.some((t) => n.normCode.toLowerCase().includes(t))
            );
          }

          if (activeNorms.length === 0 && agent.regulatoryFramework) {
            const frameworkLower = agent.regulatoryFramework.toLowerCase();
            activeNorms = NORMS_CATALOG.filter(
              (n) =>
                frameworkLower.includes(n.source.toLowerCase()) ||
                frameworkLower.includes(n.normCode.toLowerCase())
            );
          }

          if (activeNorms.length === 0) {
            activeNorms = [...NORMS_CATALOG];
          }

          const systemPrompt =
            agent.systemPrompt && agent.systemPrompt.trim().length > 10
              ? agent.systemPrompt.trim()
              : `Você é o agente especialista "${agent.name}" (${agent.code}).
Finalidade e escopo: ${agent.description}.
Marco Regulatório auditado: ${agent.regulatoryFramework || 'Conformidade e Deontologia em Saúde'}.
Normas vinculadas: ${activeNorms.map((n) => n.normCode).join(', ')}.`;

          return {
            id: agent.id,
            name: agent.name,
            code: agent.code || undefined,
            description: agent.description || undefined,
            regulatoryFramework: agent.regulatoryFramework || undefined,
            systemPrompt,
            targetNorms: agent.targetNorms || [],
            activeNorms,
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
   * Executa a auditoria deontológica com cascata de resiliência e contexto dinâmico do agente:
   * 1. Google Gemini (Gemini 2.0 Flash)
   * 2. Fallback: Ollama Local (qwen2.5:7b)
   * 3. Fallback: Heurística Dinâmica orientada às normas e contexto do agente
   */
  public static async reconcile(scrape: ScrapeResult, agentModuleId?: string): Promise<ReconciliationOutput> {
    const activeModel = await this.getActiveModelConfig();
    const effectiveProvider = activeModel.provider || this.activeProvider;
    console.log(`[ReconciliationEngine] Iniciando auditoria para ${scrape.url} usando modelo: ${activeModel.name} (${effectiveProvider})`);

    // Consome o contexto do agente dinamicamente a partir do banco de dados
    const agentContext = await this.resolveAgentContext(agentModuleId);

    // Se configurado explicitamente para heurística
    if (effectiveProvider === 'heuristic') {
      return this.reconcileWithHeuristic(
        scrape,
        `Execução direta por heurística orientada ao agente (${activeModel.name})`,
        agentContext
      );
    }

    // Tentativa 1: Gemini
    if (effectiveProvider === 'gemini') {
      try {
        return await this.reconcileWithGemini(scrape, agentContext, activeModel);
      } catch (err: any) {
        console.warn(`[ReconciliationEngine] Falha na chamada ao Google Gemini (${err.message}). Tentando fallback para Ollama...`);
      }
    }

    // Tentativa 2: Ollama Local
    try {
      return await this.reconcileWithOllama(scrape, agentContext, activeModel);
    } catch (err: any) {
      console.warn(`[ReconciliationEngine] Falha no Ollama Local (${err.message}). Ativando Heurística orientada ao Agente...`);
    }

    // Tentativa 3: Heurística Dinâmica Garantida com as normas e regras do agente
    return this.reconcileWithHeuristic(
      scrape,
      `Fallback automático ativado: Análise orientada ao agente (${activeModel.name})`,
      agentContext
    );
  }

  /**
   * Chamada com Google Gemini via novo SDK @google/genai com Structured Output e Contexto do Agente
   */
  private static async reconcileWithGemini(
    scrape: ScrapeResult,
    agentContext: AgentContext,
    modelConfig?: any
  ): Promise<ReconciliationOutput> {
    const apiKey = modelConfig?.apiKey || env.GEMINI_API_KEY;
    const modelId = modelConfig?.modelId || 'gemini-2.0-flash';

    if (!apiKey || apiKey === 'mock-key-for-tests-and-dev') {
      throw new Error('Chave de API do Gemini não configurada em ambiente real.');
    }

    const ai = new GoogleGenAI({ apiKey });

    // O agente fornece todo o seu contexto e diretrizes deontológicas
    const systemInstruction = agentContext.systemPrompt;

    const relevantNorms = agentContext.activeNorms
      .map((n) => `[${n.normCode} - ${n.article}] ${n.title}: ${n.content} (Severidade: ${n.severityDefault})`)
      .join('\n');

    const prompt = `
CONTEÚDO AUDITADO:
Título: ${scrape.title}
URL: ${scrape.url}
Markdown da Página:
${scrape.cleanMarkdown.substring(0, 10000)}

NORMAS VINCULADAS AO AGENTE:
${relevantNorms}

ENTIDADES DETECTADAS NO PROCESSAMENTO DA PÁGINA:
- CRMs: ${scrape.extractedEntities.crms.join(', ') || 'Nenhum detectado'}
- RQEs: ${scrape.extractedEntities.rqes.join(', ') || 'Nenhum detectado'}
- Estados (UF): ${scrape.extractedEntities.states.join(', ') || 'Nenhum detectado'}
- Menção a Antes/Depois: ${scrape.extractedEntities.hasBeforeAfterMention}
- Menção a Promoção/Descontos: ${scrape.extractedEntities.hasPromotionalPricing}
- Menção a Promessa/Garantia de Resultado: ${scrape.extractedEntities.hasGuaranteedResultMention}

INSTRUÇÃO DE RESPOSTA:
Realize a auditoria com base estritamente no escopo e diretrizes do agente e nas normas vinculadas.
Retorne o resultado estritamente em formato JSON estruturado conforme o seguinte contrato:
{
  "verdict": "CONFORME" | "PARCIALMENTE_CONFORME" | "NAO_CONFORME",
  "score": número de 0 a 100,
  "summary": "Síntese diagnóstica da auditoria",
  "violations": [
    {
      "normArticle": "Artigo específico infringido",
      "normCode": "Código da norma infringida",
      "severity": "LEVE" | "MEDIA" | "GRAVE" | "CRITICA",
      "detectedText": "Trecho ou evidência identificada",
      "correctiveAdvice": "Recomendação de correção"
    }
  ]
}
`;

    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
      },
    });

    const responseText = response.text || '{}';
    const parsed = JSON.parse(responseText);

    const usage: any = (response as any).usageMetadata || {};
    const promptTokens = usage.promptTokenCount || Math.ceil(prompt.length / 4);
    const completionTokens = usage.candidatesTokenCount || Math.ceil(responseText.length / 4);
    const totalTokens = usage.totalTokenCount || (promptTokens + completionTokens);

    const sourcesUsed = agentContext.activeNorms.map((n) => `${n.normCode} (${n.article}): ${n.title}`);

    return reconciliationOutputSchema.parse({
      ...parsed,
      promptTokens,
      completionTokens,
      totalTokens,
      sourcesUsed,
      aiModelUsed: `gemini:${modelId}`,
    });
  }

  /**
   * Chamada para Ollama Local com prompt e normas do agente consumidos do banco
   */
  private static async reconcileWithOllama(
    scrape: ScrapeResult,
    agentContext: AgentContext,
    modelConfig?: any
  ): Promise<ReconciliationOutput> {
    const ollamaUrl = modelConfig?.baseUrl || env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = modelConfig?.modelId || env.OLLAMA_MODEL || 'qwen2.5:7b';

    const relevantNorms = agentContext.activeNorms
      .map((n) => `[${n.normCode} - ${n.article}] ${n.title}: ${n.content} (Severidade: ${n.severityDefault})`)
      .join('\n');

    const prompt = `
${agentContext.systemPrompt}

NORMAS VINCULADAS AO AGENTE:
${relevantNorms}

TEXTO A AUDITAR:
${scrape.cleanMarkdown.substring(0, 4000)}

Retorne APENAS um JSON válido no formato:
{
  "verdict": "CONFORME" | "PARCIALMENTE_CONFORME" | "NAO_CONFORME",
  "score": number,
  "summary": string,
  "violations": [
    {
      "normArticle": string,
      "normCode": string,
      "severity": "LEVE" | "MEDIA" | "GRAVE" | "CRITICA",
      "detectedText": string,
      "correctiveAdvice": string
    }
  ]
}
`;

    const response = await axios.post(
      `${ollamaUrl}/api/generate`,
      {
        model,
        prompt,
        format: 'json',
        stream: false,
      },
      { timeout: 30000 }
    );

    const jsonText = response.data?.response || '{}';
    const parsed = JSON.parse(jsonText);

    const promptTokens = response.data?.prompt_eval_count || Math.ceil(prompt.length / 4);
    const completionTokens = response.data?.eval_count || Math.ceil(jsonText.length / 4);
    const totalTokens = promptTokens + completionTokens;
    const sourcesUsed = agentContext.activeNorms.map((n) => `${n.normCode} (${n.article}): ${n.title}`);

    return reconciliationOutputSchema.parse({
      ...parsed,
      promptTokens,
      completionTokens,
      totalTokens,
      sourcesUsed,
      aiModelUsed: `ollama:${model}`,
    });
  }

  /**
   * Mecanismo determinístico de regras baseado estritamente no catálogo de normas vinculado ao agente
   * Nenhum artigo, código ou orientação corretiva é fixado no código: todos os dados fluem da entidade da norma.
   */
  public static reconcileWithHeuristic(
    scrape: ScrapeResult,
    customSummaryHeader?: string,
    agentContext?: AgentContext
  ): ReconciliationOutput {
    const violations: z.infer<typeof violationSchema>[] = [];
    const textLower = scrape.cleanMarkdown.toLowerCase();

    // Normas ativas fornecidas pelo contexto do agente ou catálogo
    const activeNorms =
      agentContext?.activeNorms && agentContext.activeNorms.length > 0
        ? agentContext.activeNorms
        : NORMS_CATALOG;

    // Relação de especialidades para confronto dinâmico
    const medicalSpecialties = [
      'dermatologia',
      'dermatologista',
      'cirurgia plástica',
      'cardiologia',
      'ginecologia',
      'ortopedia',
      'oftalmologia',
      'pediatria',
      'psiquiatria',
    ];

    for (const norm of activeNorms) {
      const keywords = norm.keywords.map((k) => k.toLowerCase());

      // 1. Norma de identificação profissional (CRM / Registro)
      if (keywords.includes('crm') || keywords.includes('registro')) {
        if (scrape.extractedEntities.crms.length === 0) {
          violations.push({
            normCode: norm.normCode,
            normArticle: norm.article,
            severity: norm.severityDefault,
            detectedText: 'Nenhum número de identificação profissional (CRM) identificado no material auditado.',
            correctiveAdvice: norm.correctiveGuidance,
          });
        } else if (scrape.extractedEntities.states.length === 0) {
          violations.push({
            normCode: norm.normCode,
            normArticle: norm.article,
            severity: 'LEVE',
            detectedText: `Identificação profissional detectada (${scrape.extractedEntities.crms.join(', ')}), porém sem indicação expressa da Unidade Federativa (UF).`,
            correctiveAdvice: norm.correctiveGuidance,
          });
        }
        continue;
      }

      // 2. Norma de qualificação de especialidade (RQE / Especialista)
      if (keywords.includes('rqe') || keywords.includes('especialista') || keywords.includes('especialidade')) {
        const specialtyKeywordMatch =
          keywords.find((k) => k !== 'rqe' && k !== 'especialista' && k !== 'especialidade' && textLower.includes(k)) ||
          medicalSpecialties.find((spec) => textLower.includes(spec));

        if (specialtyKeywordMatch && scrape.extractedEntities.rqes.length === 0) {
          violations.push({
            normCode: norm.normCode,
            normArticle: norm.article,
            severity: norm.severityDefault,
            detectedText: `Menção a especialidade médica ("${specialtyKeywordMatch}") sem a concomitante divulgação do respectivo registro de qualificação.`,
            correctiveAdvice: norm.correctiveGuidance,
          });
        }
        continue;
      }

      // 3. Norma de vedação a promessas de resultado, cura ou sensacionalismo
      if (
        keywords.some((k) => ['garantido', '100%', 'cura definitiva', 'promessa', 'resultado', 'infalível'].includes(k))
      ) {
        const matchedPromise = keywords.find((k) => textLower.includes(k));
        if (scrape.extractedEntities.hasGuaranteedResultMention || matchedPromise) {
          violations.push({
            normCode: norm.normCode,
            normArticle: norm.article,
            severity: norm.severityDefault,
            detectedText: `Uso de alegação sensacionalista ou garantia de resultado identificada: "${matchedPromise || 'Expressão de garantia de resultado'}".`,
            correctiveAdvice: norm.correctiveGuidance,
          });
        }
        continue;
      }

      // 4. Norma de imagens comparativas ("Antes e Depois")
      if (keywords.some((k) => ['antes e depois', 'fotos comparativas', 'transformação'].includes(k))) {
        const matchedBeforeAfter = keywords.find((k) => textLower.includes(k));
        if (scrape.extractedEntities.hasBeforeAfterMention || matchedBeforeAfter) {
          violations.push({
            normCode: norm.normCode,
            normArticle: norm.article,
            severity: norm.severityDefault,
            detectedText: `Identificada veiculação de comparação de imagens de "Antes e Depois" ou evolução de procedimento: "${matchedBeforeAfter || 'Antes e depois'}".`,
            correctiveAdvice: norm.correctiveGuidance,
          });
        }
        continue;
      }

      // 5. Norma de proibição de mercantilização, promoções, cupons e sorteios
      if (
        keywords.some((k) => ['promoção', 'desconto', 'black friday', 'sorteio', 'consórcio', 'cupom', 'combo'].includes(k))
      ) {
        const matchedPromo = keywords.find((k) => textLower.includes(k));
        if (scrape.extractedEntities.hasPromotionalPricing || matchedPromo) {
          violations.push({
            normCode: norm.normCode,
            normArticle: norm.article,
            severity: norm.severityDefault,
            detectedText: `Publicidade com caráter mercantil e promocional identificada: "${matchedPromo || 'Termo promocional'}".`,
            correctiveAdvice: norm.correctiveGuidance,
          });
        }
        continue;
      }

      // 6. Norma de proteção de dados e privacidade (LGPD em Saúde)
      if (keywords.some((k) => ['privacidade', 'dados de saúde', 'consentimento', 'lgpd'].includes(k))) {
        const hasCaptureChannel =
          textLower.includes('agendar') ||
          textLower.includes('contato') ||
          textLower.includes('telefone') ||
          textLower.includes('formulario') ||
          textLower.includes('formulário');

        const hasPrivacyNotice =
          textLower.includes('privacidade') || textLower.includes('lgpd') || textLower.includes('termos');

        if (hasCaptureChannel && !hasPrivacyNotice) {
          violations.push({
            normCode: norm.normCode,
            normArticle: norm.article,
            severity: norm.severityDefault,
            detectedText:
              'Página possui canal de captação de pacientes ou agendamento sem link visível para Política de Privacidade e Termos de Consentimento.',
            correctiveAdvice: norm.correctiveGuidance,
          });
        }
        continue;
      }

      // 7. Demais normas (ANS, ANVISA, etc.) confrontadas diretamente pelas palavras-chave do catálogo
      const genericMatch = keywords.find((k) => textLower.includes(k));
      if (genericMatch && norm.source === 'ANVISA') {
        violations.push({
          normCode: norm.normCode,
          normArticle: norm.article,
          severity: norm.severityDefault,
          detectedText: `Menção a medicamento ou substância sob controle identificada: "${genericMatch}".`,
          correctiveAdvice: norm.correctiveGuidance,
        });
      }
    }

    // Cálculo da pontuação de risco e veredito semáforo
    let score = 100;
    for (const v of violations) {
      if (v.severity === 'CRITICA') score -= 35;
      else if (v.severity === 'GRAVE') score -= 20;
      else if (v.severity === 'MEDIA') score -= 10;
      else if (v.severity === 'LEVE') score -= 5;
    }
    score = Math.max(0, Math.min(100, score));

    let verdict: Verdict;
    if (score >= 85 && violations.filter((v) => v.severity === 'CRITICA').length === 0) {
      verdict = 'CONFORME';
    } else if (score >= 50 && violations.filter((v) => v.severity === 'CRITICA').length === 0) {
      verdict = 'PARCIALMENTE_CONFORME';
    } else {
      verdict = 'NAO_CONFORME';
    }

    const header = customSummaryHeader ? `${customSummaryHeader}. ` : '';
    const summary = `${header}Auditoria concluída com ${violations.length} não-conformidade(s) identificada(s) sob as normas vinculadas ao agente. Veredito Semáforo: ${verdict} (Score: ${score}/100).`;

    // Telemetria determinística para modo heurístico
    const estimatedPrompt = Math.ceil(scrape.cleanMarkdown.length / 4);
    const estimatedCompletion = Math.ceil(summary.length / 4) + violations.length * 40;
    const promptTokens = estimatedPrompt;
    const completionTokens = estimatedCompletion;
    const totalTokens = promptTokens + completionTokens;

    // Fontes/artigos ativados a partir das normas vinculadas
    const sourcesUsed = Array.from(new Set(violations.map((v) => `${v.normCode} (${v.normArticle})`)));
    if (sourcesUsed.length === 0) {
      activeNorms.slice(0, 3).forEach((n) => sourcesUsed.push(`${n.normCode} (${n.article})`));
    }

    return {
      verdict,
      score,
      summary,
      violations,
      promptTokens,
      completionTokens,
      totalTokens,
      sourcesUsed,
      aiModelUsed: 'regex-heuristic-engine',
    };
  }
}

