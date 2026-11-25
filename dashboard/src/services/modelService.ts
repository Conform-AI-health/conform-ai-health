import { ModelRepository } from '../repositories/modelRepository.js';
import { encryptModelApiKey, maskApiKey } from '../shared/encryption.js';
import { validateSafeUrlAsync, isAllowedLocalhostBaseUrl } from '../shared/security.js';
import { AIProviderFactory } from './ai/aiProviderFactory.js';
import { ReconciliationEngine } from './reconciliationEngine.js';
import { AiModelConfig, Prisma } from '@prisma/client';

export interface ModelListQuery {
  page?: number;
  limit?: number;
  skip?: number;
  search?: string;
  provider?: string;
}

export class ModelService {
  /**
   * Lista modelos cadastrados com suporte a busca, filtros e mascaramento de segredos
   */
  public static async listModels(query: ModelListQuery) {
    const { skip, limit, search, provider } = query;

    const where: Prisma.AiModelConfigWhereInput = {};
    if (provider) where.provider = provider;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { modelId: { contains: search, mode: 'insensitive' } },
      ];
    }

    let [total, models] = await Promise.all([
      ModelRepository.count(where),
      ModelRepository.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    // Se a base de dados estiver vazia (primeira execução), provisiona os modelos oficiais automaticamente
    if (total === 0 && !search && !provider) {
      console.log('🤖 [ModelService] Nenhum modelo no banco. Provisionando modelos padrão oficiais...');
      await ModelRepository.createMany([
        {
          name: 'Google Gemini 3.5 Flash',
          provider: 'gemini',
          modelId: 'gemini-3.5-flash',
          isActive: true,
          isDefault: true,
          temperature: 0.2,
          maxTokens: 2048,
          description: 'Modelo multimodal de alta velocidade e precisão para auditoria do Catálogo Normativo Dinâmico em Saúde.',
        },
        {
          name: 'Ollama Local (Qwen 2.5)',
          provider: 'ollama',
          modelId: 'qwen2.5:7b',
          baseUrl: 'http://localhost:11434',
          isActive: false,
          isDefault: false,
          temperature: 0.2,
          maxTokens: 2048,
          description: 'Modelo open-source executado localmente para soberania e privacidade de dados em saúde.',
        },
        {
          name: 'Motor Heurístico Deontológico',
          provider: 'heuristic',
          modelId: 'regex-heuristic-v1',
          isActive: false,
          isDefault: false,
          temperature: 0.0,
          maxTokens: 1024,
          description: 'Motor determinístico baseado no catálogo de artigos, regras gramaticais e regex.',
        },
      ]);
      total = await ModelRepository.count();
      models = await ModelRepository.findMany({
        skip,
        take: limit,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      });
    }

    const sanitizedModels = models.map((m) => ({
      ...m,
      apiKey: maskApiKey(m.apiKey),
    }));

    return { models: sanitizedModels, total };
  }

  /**
   * Obtém detalhes de um modelo mascarando segredos
   */
  public static async getModelById(id: string): Promise<AiModelConfig | null> {
    const model = await ModelRepository.findById(id);
    if (!model) return null;
    return {
      ...model,
      apiKey: maskApiKey(model.apiKey),
    };
  }

  /**
   * Cadastra novo modelo com validação de segurança e criptografia de chave em repouso
   */
  public static async createModel(data: any): Promise<AiModelConfig> {
    if (data.baseUrl && data.baseUrl.trim().length > 0) {
      const isLoopback = isAllowedLocalhostBaseUrl(data.baseUrl.trim());
      if (!isLoopback) {
        const check = await validateSafeUrlAsync(data.baseUrl.trim());
        if (!check.safe) {
          throw new Error(`URL base de inferência rejeitada por segurança: ${check.reason}`);
        }
      }
    }

    if (data.isActive) {
      await ModelRepository.updateMany({ isActive: true }, { isActive: false });
    }

    const encryptedKey = data.apiKey && data.apiKey.trim().length > 0
      ? encryptModelApiKey(data.apiKey.trim())
      : null;

    const created = await ModelRepository.create({
      name: data.name,
      provider: data.provider,
      modelId: data.modelId,
      baseUrl: data.baseUrl || null,
      apiKey: encryptedKey,
      temperature: data.temperature ?? 0.2,
      maxTokens: data.maxTokens ?? 2048,
      description: data.description || null,
      isActive: data.isActive ?? false,
      isDefault: data.isDefault ?? false,
    });

    if (created.isActive) {
      AIProviderFactory.setActiveProvider(created.provider as any);
    }

    return {
      ...created,
      apiKey: maskApiKey(created.apiKey),
    };
  }

  /**
   * Atualização parcial ou total de modelo com validação e salvaguarda de segredos
   */
  public static async updateModel(id: string, data: any): Promise<AiModelConfig> {
    const existing = await ModelRepository.findById(id);
    if (!existing) {
      throw new Error('MODEL_NOT_FOUND');
    }

    if (data.baseUrl && data.baseUrl.trim().length > 0) {
      const isLoopback = isAllowedLocalhostBaseUrl(data.baseUrl.trim());
      if (!isLoopback) {
        const check = await validateSafeUrlAsync(data.baseUrl.trim());
        if (!check.safe) {
          throw new Error(`URL base de inferência rejeitada por segurança: ${check.reason}`);
        }
      }
    }

    if (data.isActive && !existing.isActive) {
      await ModelRepository.updateMany({ id: { not: id }, isActive: true }, { isActive: false });
    }

    const updateData: any = { ...data };
    if (data.apiKey !== undefined) {
      if (!data.apiKey || data.apiKey.trim().length === 0 || data.apiKey.includes('****')) {
        delete updateData.apiKey;
      } else {
        updateData.apiKey = encryptModelApiKey(data.apiKey.trim());
      }
    }

    const updated = await ModelRepository.update(id, updateData);

    if (updated.isActive) {
      AIProviderFactory.setActiveProvider(updated.provider as any);
    }

    return {
      ...updated,
      apiKey: maskApiKey(updated.apiKey),
    };
  }

  /**
   * Ativação de modelo em tempo de execução
   */
  public static async activateModel(id: string): Promise<AiModelConfig> {
    const target = await ModelRepository.findById(id);
    if (!target) {
      throw new Error('MODEL_NOT_FOUND');
    }

    await ModelRepository.updateMany({ id: { not: id }, isActive: true }, { isActive: false });
    const activated = await ModelRepository.update(id, { isActive: true });
    AIProviderFactory.setActiveProvider((activated.provider || target.provider) as any);

    return {
      ...target,
      ...activated,
      apiKey: maskApiKey(target.apiKey),
    };
  }

  /**
   * Exclusão segura de modelo de IA
   */
  public static async deleteModel(id: string): Promise<void> {
    const existing = await ModelRepository.findById(id);
    if (!existing) {
      throw new Error('MODEL_NOT_FOUND');
    }
    if (existing.isActive) {
      throw new Error('CANNOT_DELETE_ACTIVE_MODEL');
    }
    await ModelRepository.delete(id);
  }

  /**
   * Diagnóstico do modelo
   */
  public static async testModel(id: string, prompt?: string) {
    return await ReconciliationEngine.testModelResponse(prompt, id);
  }
}
