import { CircuitBreaker } from '../../shared/circuitBreaker.js';
import { ScrapeResult } from '../scraperService.js';
import { AgentContext, ReconciliationOutput } from '../../shared/reconciliationTypes.js';

export type AIProviderType = 'gemini' | 'ollama' | 'heuristic';

export interface AIProviderRequest {
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
  modelId?: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  responseSchema?: any;
}

export interface AIProviderResponse {
  text: string;
  parsedOutput?: any;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  modelUsed: string;
  provider: AIProviderType;
}

export interface AIProviderHealth {
  provider: string;
  model: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  latencyMs: number;
  response: string;
  testedAt: string;
  details?: any;
}

export interface IAIProvider {
  readonly providerId: AIProviderType;
  readonly displayName: string;
  getCircuitBreaker(): CircuitBreaker;
  reconcile(
    scrape: ScrapeResult,
    agentContext: AgentContext,
    modelConfig: any
  ): Promise<ReconciliationOutput>;
  testConnection(customPrompt?: string, targetModel?: any): Promise<AIProviderHealth>;
}
