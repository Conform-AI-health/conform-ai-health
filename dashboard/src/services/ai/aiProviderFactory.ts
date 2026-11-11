import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { Bulkhead } from '../../shared/bulkhead.js';
import { ScrapeResult } from '../scraperService.js';
import { AgentContext, ReconciliationOutput } from '../../shared/reconciliationTypes.js';
import { decryptModelApiKey } from '../../shared/encryption.js';
import { IAIProvider, AIProviderType, AIProviderHealth } from './aiProvider.interface.js';
import { GeminiProvider } from './geminiProvider.js';
import { OllamaProvider } from './ollamaProvider.js';
import { HeuristicProvider } from './heuristicProvider.js';

export class AIProviderFactory {
  private static providers: Map<AIProviderType, IAIProvider> = new Map();
  private static activeProviderName: AIProviderType = (env.AI_PROVIDER as any) || 'gemini';
  private static cachedActiveModel: any = null;
  private static cacheTimestamp: number = 0;

  // Bulkhead para limitar concorrência e proteger CPU/memória da aplicação
  public static aiBulkhead = new Bulkhead({
    name: 'AIPool',
    maxConcurrent: 5,
    maxQueue: 20,
    timeoutMs: 30000,
  });

  static {
    // Registra os 3 provedores oficiais no bootstrap
    this.providers.set('gemini', new GeminiProvider());
    this.providers.set('ollama', new OllamaProvider());
    this.providers.set('heuristic', new HeuristicProvider());
  }

  public static getProvider(type?: AIProviderType): IAIProvider {
    const target = type || this.activeProviderName;
    const provider = this.providers.get(target);
    if (!provider) {
      console.warn(`[AIProviderFactory] Provedor "${target}" não encontrado. Utilizando HeuristicProvider como contingência.`);
      return this.providers.get('heuristic')!;
    }
    return provider;
  }

  public static getActiveProviderName(): AIProviderType {
    return this.activeProviderName;
  }

  public static setActiveProvider(type: AIProviderType): void {
    if (this.providers.has(type)) {
      this.activeProviderName = type;
      this.invalidateModelCache();
      console.log(`[AIProviderFactory] Provedor de IA alternado com sucesso para: ${type}`);
    } else {
      console.warn(`[AIProviderFactory] Tentativa de ativar provedor desconhecido: ${type}`);
    }
  }

  public static invalidateModelCache(): void {
    this.cachedActiveModel = null;
    this.cacheTimestamp = 0;
  }

  public static async getActiveModelConfig(): Promise<{
    id?: string;
    name: string;
    provider: AIProviderType;
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
          provider: activeFromDb.provider as AIProviderType,
          modelId: activeFromDb.modelId,
          baseUrl: activeFromDb.baseUrl || env.OLLAMA_BASE_URL,
          apiKey: decryptModelApiKey(activeFromDb.apiKey) || env.GEMINI_API_KEY,
          temperature: activeFromDb.temperature ?? 0.2,
          maxTokens: activeFromDb.maxTokens ?? 2048,
        };
        this.activeProviderName = this.cachedActiveModel.provider;
        this.cacheTimestamp = now;
        return this.cachedActiveModel;
      }
    } catch {
      // Fallback gracioso
    }

    return {
      name:
        this.activeProviderName === 'gemini'
          ? 'Google Gemini 3.5 Flash'
          : this.activeProviderName === 'ollama'
          ? 'Ollama Local'
          : 'Motor Heurístico Deontológico',
      provider: this.activeProviderName,
      modelId:
        this.activeProviderName === 'gemini'
          ? 'gemini-3.5-flash'
          : this.activeProviderName === 'ollama'
          ? env.OLLAMA_MODEL
          : 'regex-heuristic-v1',
      baseUrl: env.OLLAMA_BASE_URL,
      apiKey: env.GEMINI_API_KEY,
      temperature: 0.2,
      maxTokens: 2048,
    };
  }

  /**
   * Executa a reconciliação deontológica com proteção do Bulkhead e fallback em cascata
   */
  public static async reconcile(
    scrape: ScrapeResult,
    agentContext: AgentContext
  ): Promise<ReconciliationOutput> {
    const activeModel = await this.getActiveModelConfig();
    const primaryProvider = this.getProvider(activeModel.provider);

    return await this.aiBulkhead.execute(async () => {
      // Tentativa 1: Provedor Ativo (Gemini ou Ollama)
      try {
        if (activeModel.provider !== 'heuristic') {
          return await primaryProvider.reconcile(scrape, agentContext, activeModel);
        }
      } catch (err: any) {
        console.warn(`[AIProviderFactory] Falha no provedor primário ${activeModel.provider}: ${err.message}. Ativando cascata de resiliência...`);
      }

      // Tentativa 2: Ollama Local (se o primário era Gemini)
      // AI-02: Garantir que o Ollama use parâmetros isolados (modelId e baseUrl) e nunca o modelId do Gemini
      if (activeModel.provider === 'gemini') {
        try {
          const ollama = this.getProvider('ollama');
          let ollamaDbConfig = null;
          try {
            ollamaDbConfig = await prisma.aiModelConfig.findFirst({
              where: { provider: 'ollama' },
            });
          } catch {
            // Falha graciosa de I/O
          }

          const ollamaModelConfig = {
            id: ollamaDbConfig?.id,
            name: ollamaDbConfig?.name || 'Ollama Local Fallback',
            provider: 'ollama' as AIProviderType,
            modelId: ollamaDbConfig?.modelId || env.OLLAMA_MODEL || 'qwen2.5:7b',
            baseUrl: ollamaDbConfig?.baseUrl || env.OLLAMA_BASE_URL || 'http://localhost:11434',
            apiKey: null,
            temperature: ollamaDbConfig?.temperature ?? activeModel.temperature ?? 0.2,
            maxTokens: ollamaDbConfig?.maxTokens ?? activeModel.maxTokens ?? 2048,
          };

          return await ollama.reconcile(scrape, agentContext, ollamaModelConfig);
        } catch (err: any) {
          console.warn(`[AIProviderFactory] Falha no Ollama Local: ${err.message}. Ativando Heurística...`);
        }
      }

      // Tentativa 3: Motor Heurístico Garantido (Sem dependência de rede)
      const heuristic = this.getProvider('heuristic') as HeuristicProvider;
      return heuristic.executeHeuristic(
        scrape,
        `Fallback automático ativado: Análise orientada ao agente (${activeModel.name})`,
        agentContext
      );
    });
  }

  /**
   * Executa teste diagnóstico de conectividade com o modelo
   */
  public static async testModelResponse(
    customPrompt?: string,
    targetModelId?: string
  ): Promise<AIProviderHealth> {
    let activeModel: any = null;
    if (targetModelId) {
      activeModel = await prisma.aiModelConfig.findUnique({ where: { id: targetModelId } }).catch(() => null);
      if (activeModel?.apiKey) {
        activeModel.apiKey = decryptModelApiKey(activeModel.apiKey) || activeModel.apiKey;
      }
    }
    if (!activeModel) {
      activeModel = await this.getActiveModelConfig();
    }

    const provider = this.getProvider(activeModel.provider);
    return await provider.testConnection(customPrompt, activeModel);
  }

  public static listProviders(): Array<{ id: AIProviderType; name: string; isActive: boolean }> {
    return Array.from(this.providers.entries()).map(([id, p]) => ({
      id,
      name: p.displayName,
      isActive: id === this.activeProviderName,
    }));
  }
}
