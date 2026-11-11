import axios from 'axios';
import { env } from '../../config/env.js';
import { CircuitBreaker } from '../../shared/circuitBreaker.js';
import { AIGuardrails } from '../../shared/aiGuardrails.js';
import { ScrapeResult } from '../scraperService.js';
import { AgentContext, ReconciliationOutput, reconciliationOutputSchema } from '../../shared/reconciliationTypes.js';
import { safeHttpPostJson } from '../../shared/security.js';
import { IAIProvider, AIProviderHealth, AIProviderType } from './aiProvider.interface.js';

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
      const ollamaUrl = modelConfig?.baseUrl || env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const model = modelConfig?.modelId || env.OLLAMA_MODEL || 'qwen2.5:7b';

      const relevantNorms = agentContext.activeNorms
        .map((n) => `[${n.normCode} - ${n.article}] ${n.title}: ${n.content} (Severidade: ${n.severityDefault})`)
        .join('\n');

      const secureAudit = AIGuardrails.generateSecureAuditBlock(
        scrape.cleanMarkdown.substring(0, 6000),
        scrape.url
      );
      const groundingInstructions = AIGuardrails.buildGroundingPromptInstructions(agentContext.activeNorms);

      const resolvedSystemPrompt = agentContext.systemPrompt.includes('{normasVigentesDoEscopo}')
        ? agentContext.systemPrompt.replace(/\{normasVigentesDoEscopo\}/g, relevantNorms)
        : agentContext.systemPrompt;

      const prompt = `
${resolvedSystemPrompt}

${groundingInstructions}

NORMAS VINCULADAS AO AGENTE:
${relevantNorms}

${secureAudit.secureBlock}

Retorne APENAS um JSON válido no formato:
{
  "verdict": "CONFORME" | "PARCIALMENTE_CONFORME" | "NAO_CONFORME" | "INCONCLUSIVO",
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

      const response = await safeHttpPostJson(
        `${ollamaUrl}/api/generate`,
        {
          model,
          prompt,
          format: 'json',
          stream: false,
        },
        { timeout: 30000 }
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
    const ollamaUrl = targetModel?.baseUrl || env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = targetModel?.modelId || env.OLLAMA_MODEL || 'qwen2.5:7b';
    const prompt =
      customPrompt ||
      'Teste de integridade Conform.AI: Confirme em uma frase sucinta a prontidão para auditoria deontológica com base no catálogo normativo dinâmico.';

    try {
      const response = await safeHttpPostJson(
        `${ollamaUrl}/api/generate`,
        {
          model,
          prompt,
          stream: false,
        },
        { timeout: 8000 }
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
      return {
        provider: 'ollama',
        model,
        status: 'OFFLINE',
        latencyMs: Date.now() - startTime,
        response: `Falha ao conectar com o Ollama em ${ollamaUrl}: ${err.message}`,
        testedAt: new Date().toISOString(),
      };
    }
  }
}
