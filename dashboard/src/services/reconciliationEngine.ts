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

export class ReconciliationEngine {
  private static activeProvider: 'gemini' | 'ollama' | 'heuristic' = (env.AI_PROVIDER as any) || 'gemini';
  private static cachedActiveModel: any = null;
  private static cacheTimestamp: number = 0;

  public static invalidateModelCache(): void {
    this.cachedActiveModel = null;
    this.cacheTimestamp = 0;
  }

  public static async getActiveModelConfig(): Promise<{
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
   * Realiza teste pontual de integridade, latência e conectividade com o modelo ativo
   */
  public static async testModelResponse(customPrompt?: string): Promise<{
    provider: string;
    model: string;
    status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
    latencyMs: number;
    response: string;
    testedAt: string;
    details?: any;
  }> {
    const startTime = Date.now();
    const activeModel = await this.getActiveModelConfig();
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
   * Executa a auditoria deontológica com cascata de resiliência:
   * 1. Google Gemini (Gemini 2.0 Flash)
   * 2. Fallback: Ollama Local (qwen2.5:7b)
   * 3. Fallback: Heurística Deontológica Determinística por Regras/Regex
   */
  public static async reconcile(scrape: ScrapeResult): Promise<ReconciliationOutput> {
    console.log(`[ReconciliationEngine] Iniciando auditoria para ${scrape.url} usando provedor preferencial: ${this.activeProvider}`);

    // Se configurado explicitamente para heurística
    if (this.activeProvider === 'heuristic') {
      return this.reconcileWithHeuristic(scrape, 'Execução direta por heurística determinística');
    }

    // Tentativa 1: Gemini
    if (this.activeProvider === 'gemini' && env.GEMINI_API_KEY && env.GEMINI_API_KEY !== 'mock-key-for-tests-and-dev') {
      try {
        return await this.reconcileWithGemini(scrape);
      } catch (err: any) {
        console.warn(`[ReconciliationEngine] Falha na chamada ao Google Gemini (${err.message}). Tentando fallback para Ollama...`);
      }
    }

    // Tentativa 2: Ollama Local
    try {
      return await this.reconcileWithOllama(scrape);
    } catch (err: any) {
      console.warn(`[ReconciliationEngine] Falha no Ollama Local (${err.message}). Ativando Heurística Deontológica por Regras...`);
    }

    // Tentativa 3: Heurística Determinística Garantida
    return this.reconcileWithHeuristic(scrape, 'Fallback automático ativado: Análise deontológica por regras e catálogo');
  }

  /**
   * Chamada com Google Gemini via novo SDK @google/genai com Structured Output
   */
  private static async reconcileWithGemini(scrape: ScrapeResult): Promise<ReconciliationOutput> {
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

    const systemPrompt = `
Você é o Auditor Deontológico Sênior da ConformIA, especialista na Resolução CFM nº, ANS, ANVISA e LGPD em Saúde.
Sua missão é auditar o conteúdo textual e descritivo de materiais médicos e confrontá-los com o catálogo de normas.
Você DEVE responder estritamente no formato JSON estruturado definido pelo schema.
Critérios de severidade:
- CRITICA: Ausência total de CRM/RQE ao divulgar especialidade médica, promessa de cura ou resultado 100% garantido, propaganda de remédio sob prescrição ao público leigo, vazamento de dados de saúde.
- GRAVE: Fotos de "Antes e Depois" com nítido caráter autopromocional/comercial, anúncios de descontos, cupom promocional, "black friday", sorteios.
- MEDIA: Ausência de clareza sobre credenciamento de convênios ANS ou adjetivação exagerada sobre aparelhos sem comprovação.
- LEVE: CRM informado sem UF correspondente ou pequenos erros de digitação de especialidade.
`;

    const relevantNorms = NORMS_CATALOG.map(
      (n) => `[${n.normCode} - ${n.article}] ${n.title}: ${n.content} (Severidade: ${n.severityDefault})`
    ).join('\n');

    const prompt = `
CONTEÚDO AUDITADO:
Título: ${scrape.title}
URL: ${scrape.url}
Markdown da Página:
${scrape.cleanMarkdown.substring(0, 10000)}

NORMAS VIGENTES:
${relevantNorms}

ENTIDADES DETECTADAS NO SCRAPING:
- CRMs: ${scrape.extractedEntities.crms.join(', ') || 'Nenhum detectado'}
- RQEs: ${scrape.extractedEntities.rqes.join(', ') || 'Nenhum detectado'}
- Estados: ${scrape.extractedEntities.states.join(', ') || 'Nenhum detectado'}
- Menção a Antes/Depois: ${scrape.extractedEntities.hasBeforeAfterMention}
- Menção a Promoção/Descontos: ${scrape.extractedEntities.hasPromotionalPricing}
- Menção a Promessa/Garantia de Resultado: ${scrape.extractedEntities.hasGuaranteedResultMention}

Faça a auditoria completa e retorne o JSON com verdict, score, summary e array de violations.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
      },
    });

    const responseText = response.text || '{}';
    const parsed = JSON.parse(responseText);

    const usage: any = (response as any).usageMetadata || {};
    const promptTokens = usage.promptTokenCount || Math.ceil(prompt.length / 4);
    const completionTokens = usage.candidatesTokenCount || Math.ceil(responseText.length / 4);
    const totalTokens = usage.totalTokenCount || (promptTokens + completionTokens);

    const sourcesUsed = NORMS_CATALOG.map((n) => `${n.normCode} (${n.article}): ${n.title}`);

    return reconciliationOutputSchema.parse({
      ...parsed,
      promptTokens,
      completionTokens,
      totalTokens,
      sourcesUsed,
      aiModelUsed: 'gemini-2.0-flash',
    });
  }

  /**
   * Chamada para Ollama Local (ex: qwen2.5:7b ou llama3)
   */
  private static async reconcileWithOllama(scrape: ScrapeResult): Promise<ReconciliationOutput> {
    const prompt = `
Você é o Auditor Deontológico da ConformIA. Audite o seguinte material sob a Resolução CFM 2.336/23 e LGPD.
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

TEXTO A AUDITAR:
${scrape.cleanMarkdown.substring(0, 4000)}
`;

    const response = await axios.post(
      `${env.OLLAMA_BASE_URL}/api/generate`,
      {
        model: env.OLLAMA_MODEL,
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
    const sourcesUsed = NORMS_CATALOG.map((n) => `${n.normCode} (${n.article}): ${n.title}`);

    return reconciliationOutputSchema.parse({
      ...parsed,
      promptTokens,
      completionTokens,
      totalTokens,
      sourcesUsed,
      aiModelUsed: `ollama:${env.OLLAMA_MODEL}`,
    });
  }

  /**
   * Mecanismo determinístico de regras baseado no catálogo deontológico e regex
   */
  public static reconcileWithHeuristic(
    scrape: ScrapeResult,
    customSummaryHeader?: string
  ): ReconciliationOutput {
    const violations: z.infer<typeof violationSchema>[] = [];
    const textLower = scrape.cleanMarkdown.toLowerCase();

    // 1. Verificação de CRM
    if (scrape.extractedEntities.crms.length === 0) {
      violations.push({
        normCode: 'Res. CFM 2.336/23',
        normArticle: 'Artigo 1º, § 1º',
        severity: 'CRITICA',
        detectedText: 'Nenhum número de CRM visível identificado no material auditado.',
        correctiveAdvice:
          'Insira o nome completo do médico responsável e o respectivo número de CRM com UF (Ex: CRM/SP 123456) em destaque no cabeçalho e rodapé.',
      });
    } else {
      // Verificar se há UF associada
      if (scrape.extractedEntities.states.length === 0) {
        violations.push({
          normCode: 'Res. CFM 2.336/23',
          normArticle: 'Artigo 1º, § 1º',
          severity: 'LEVE',
          detectedText: `CRM detectado (${scrape.extractedEntities.crms.join(', ')}), porém sem indicação expressa da sigla do Estado federativo.`,
          correctiveAdvice: 'Adicione a sigla do estado ao lado do número do CRM (exemplo: CRM-SP ou CRM/SP).',
        });
      }
    }

    // 2. Verificação de Especialidade vs RQE
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

    const hasSpecialtyMention = medicalSpecialties.some((spec) => textLower.includes(spec));
    if (hasSpecialtyMention && scrape.extractedEntities.rqes.length === 0) {
      violations.push({
        normCode: 'Res. CFM 2.336/23',
        normArticle: 'Artigo 1º, § 2º e Artigo 2º',
        severity: 'CRITICA',
        detectedText:
          'Menção a especialidade médica sem a concomitante divulgação do Registro de Qualificação de Especialista (RQE).',
        correctiveAdvice:
          'Ao divulgar qualquer especialidade médica, é obrigatório publicar o número do RQE correspondente registrado no CRM local.',
      });
    }

    // 3. Verificação de Promessa de Resultado
    if (scrape.extractedEntities.hasGuaranteedResultMention) {
      const detectedFragment =
        textLower.match(/(100% garantido|resultado garantido|cura definitiva|o melhor médico|a melhor clínica|infalível)/i)?.[0] ||
        'Expressão de promessa de resultado';

      violations.push({
        normCode: 'Res. CFM 2.336/23',
        normArticle: 'Artigo 11, Inciso II e Artigo 14',
        severity: 'CRITICA',
        detectedText: `Uso de alegação sensacionalista ou garantia de resultado: "${detectedFragment}".`,
        correctiveAdvice:
          'Remova adjetivos que garantam cura ou resultados exatos. A medicina é atividade de meio, não de fim.',
      });
    }

    // 4. Verificação de Antes e Depois
    if (scrape.extractedEntities.hasBeforeAfterMention) {
      violations.push({
        normCode: 'Res. CFM 2.336/23',
        normArticle: 'Artigo 14, § 1º ao § 4º',
        severity: 'GRAVE',
        detectedText: 'Identificada veiculação de comparação de imagens de "Antes e Depois".',
        correctiveAdvice:
          'Imagens de evolução de tratamento só são permitidas com caráter estritamente educativo, com termo de consentimento específico e sem promessa de resultado idêntico.',
      });
    }

    // 5. Verificação de Mercantilização / Promoções
    if (scrape.extractedEntities.hasPromotionalPricing) {
      const detectedPromo =
        textLower.match(/(promoção|desconto|black friday|sorteio|consórcio|cupom)/i)?.[0] || 'Termo promocional';

      violations.push({
        normCode: 'Res. CFM 2.336/23',
        normArticle: 'Artigo 9º, Incisos I a V',
        severity: 'GRAVE',
        detectedText: `Publicidade com caráter mercantil e promocional identificada: "${detectedPromo}".`,
        correctiveAdvice:
          'Elimine divulgações de desconto, cupons ou sorteios de consultas/procedimentos médicos.',
      });
    }

    // 6. Verificação de LGPD em formulários
    if (textLower.includes('agendar') || textLower.includes('contato') || textLower.includes('telefone')) {
      if (!textLower.includes('privacidade') && !textLower.includes('lgpd') && !textLower.includes('termos')) {
        violations.push({
          normCode: 'LGPD Art. 11',
          normArticle: 'Artigo 11 e Artigo 14',
          severity: 'MEDIA',
          detectedText: 'Página possui formulário ou canal de captação de pacientes sem link visível para Política de Privacidade.',
          correctiveAdvice:
            'Insira link para a Política de Privacidade e Termos de Consentimento para tratamento de dados pessoais sensíveis de saúde.',
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
    const summary = `${header}Auditoria concluída com ${violations.length} não-conformidade(s) deontológica(s) encontrada(s). Veredito Semáforo: ${verdict} (Score de Conformidade: ${score}/100).`;

    // Telemetria determinística para modo heurístico
    const estimatedPrompt = Math.ceil(scrape.cleanMarkdown.length / 4);
    const estimatedCompletion = Math.ceil(summary.length / 4) + violations.length * 40;
    const promptTokens = estimatedPrompt;
    const completionTokens = estimatedCompletion;
    const totalTokens = promptTokens + completionTokens;

    // Fontes/artigos do catálogo que foram especificamente acionados
    const sourcesUsed = Array.from(new Set(violations.map((v) => `${v.normCode} (${v.normArticle})`)));
    if (sourcesUsed.length === 0) {
      sourcesUsed.push('Res. CFM 2.336/23 (Art. 1º ao 14)');
      sourcesUsed.push('LGPD em Saúde (Art. 11)');
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

