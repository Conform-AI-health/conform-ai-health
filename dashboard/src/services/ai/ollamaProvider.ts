import axios from 'axios';
import { env } from '../../config/env.js';
import { CircuitBreaker } from '../../shared/circuitBreaker.js';
import { AIGuardrails } from '../../shared/aiGuardrails.js';
import { ScrapeResult } from '../scraperService.js';
import {
  AgentContext,
  ReconciliationOutput,
  reconciliationOutputSchema,
  normalizeSeverity,
  normalizeVerdict,
} from '../../shared/reconciliationTypes.js';
import { safeHttpPostJson } from '../../shared/security.js';
import { IAIProvider, AIProviderHealth, AIProviderType } from './aiProvider.interface.js';
import { resolveOllamaBaseUrl } from './aiUrlResolver.js';

export class OllamaProvider implements IAIProvider {
  public readonly providerId: AIProviderType = 'ollama';
  public readonly displayName: string = 'Ollama Local';

  private circuitBreaker = new CircuitBreaker({
    name: 'OllamaReconciliation',
    failureThreshold: 3,
    resetTimeoutMs: 15000,
    successThreshold: 2,
  });

  public getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  public async reconcile(
    scrape: ScrapeResult,
    agentContext: AgentContext,
    modelConfig?: any
  ): Promise<ReconciliationOutput> {
    return await this.circuitBreaker.execute(async () => {
      const ollamaUrl = resolveOllamaBaseUrl(modelConfig?.baseUrl);
      const model = modelConfig?.modelId || env.OLLAMA_MODEL || 'qwen2.5:7b';

      const relevantNorms = agentContext.activeNorms
        .map((n) => `[${n.normCode} - ${n.article}] ${n.title}: ${n.content} (Severidade: ${n.severityDefault})`)
        .join('\n');

      const resolvedSystemPrompt = agentContext.systemPrompt.replace(
        /\{normasVigentesDoEscopo\}|\{CONTEUDO_DAS_NORMAS_MD\}/gi,
        relevantNorms
      );

      const secureAudit = AIGuardrails.generateSecureAuditBlock(
        scrape.cleanMarkdown.substring(0, 6000),
        scrape.url
      );
      const groundingInstructions = AIGuardrails.buildGroundingPromptInstructions(agentContext.activeNorms);

      const prompt = `
${resolvedSystemPrompt}

${groundingInstructions}

NORMAS RECUPERADAS:
${relevantNorms}

${secureAudit.secureBlock}

Retorne APENAS um JSON válido no formato:
{
  "verdict": "CONFORME" | "PARCIALMENTE_CONFORME" | "NAO_CONFORME" | "INCONCLUSIVO",
  "score": number (0 a 100),
  "summary": string,
  "violations": [
    {
      "normArticle": string,
      "normCode": string,
      "severity": "LEVE" | "MEDIA" | "GRAVE" | "CRITICA" (ATENÇÃO: use estritamente uma destas 4 opções: nunca use 'ALTA' ou 'BAIXA', use 'GRAVE' para gravidade alta e 'LEVE' para baixa),
      "detectedText": string,
      "correctiveAdvice": string
    }
  ]
}
`;

      const response = await safeHttpPostJson(
        `${ollamaUrl}/api/generate`,
        {
          model,
          prompt,
          format: 'json',
          stream: false,
        },
        { timeout: 120000 }
      );

      let jsonText = response.data?.response || '{}';
      if (jsonText.includes('```')) {
        jsonText = jsonText.replace(/```json/gi, '').replace(/```/g, '').trim();
      }

      let parsed: any;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('A resposta gerada pelo modelo Ollama não contém um JSON válido.');
        }
      }

      if (Array.isArray(parsed?.violations)) {
        parsed.violations = parsed.violations.map((v: any) => ({
          ...v,
          severity: normalizeSeverity(v?.severity),
        }));
      }
      if (parsed?.verdict) {
        parsed.verdict = normalizeVerdict(parsed.verdict);
      }

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
    });
  }

  public async testConnection(customPrompt?: string, targetModel?: any): Promise<AIProviderHealth> {
    const startTime = Date.now();
    const ollamaUrl = resolveOllamaBaseUrl(targetModel?.baseUrl);
    const model = targetModel?.modelId || env.OLLAMA_MODEL || 'qwen2.5:7b';
    const prompt =
      customPrompt ||
      'Teste de prontidão Conform.AI: Responda apenas "OK" se o motor estiver operacional.';

    try {
      const response = await safeHttpPostJson(
        `${ollamaUrl}/api/generate`,
        {
          model,
          prompt,
          stream: false,
        },
        { timeout: 60000 }
      );
      return {
        provider: 'ollama',
        model,
        status: 'ONLINE',
        latencyMs: Date.now() - startTime,
        response: response.data?.response || 'Ollama respondeu ao teste.',
        testedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      const serverError = err.response?.data?.error || err.response?.data?.message;
      const detailMsg = serverError ? `${err.message} (${serverError})` : err.message;
      return {
        provider: 'ollama',
        model,
        status: 'OFFLINE',
        latencyMs: Date.now() - startTime,
        response: `Falha ao conectar com o Ollama em ${ollamaUrl}: ${detailMsg}`,
        testedAt: new Date().toISOString(),
      };
    }
  }
}
