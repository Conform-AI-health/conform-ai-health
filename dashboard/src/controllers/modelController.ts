import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { getPaginationParams, buildPaginatedResponse } from '../shared/pagination.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { validateSafeUrlAsync, isAllowedLocalhostBaseUrl } from '../shared/security.js';
import { encryptModelApiKey, maskApiKey } from '../shared/encryption.js';

const createModelSchema = z.object({
  name: z.string().min(2, 'Nome do modelo é obrigatório'),
  provider: z.enum(['gemini', 'ollama', 'heuristic'], {
    errorMap: () => ({ message: 'Provedor deve ser gemini, ollama ou heuristic' }),
  }),
  modelId: z.string().min(2, 'Identificador técnico do modelo é obrigatório (ex: gemini-2.0-flash, qwen2.5:7b)'),
  baseUrl: z.string().optional().nullable().or(z.literal('')),
  apiKey: z.string().optional().nullable().or(z.literal('')),
  temperature: z.coerce.number().min(0).max(2).default(0.2),
  maxTokens: z.coerce.number().min(128).max(32768).default(2048),
  description: z.string().optional().nullable().or(z.literal('')),
  isActive: z.boolean().optional().default(false),
  isDefault: z.boolean().optional().default(false),
});

const updateModelSchema = createModelSchema.partial();

export class ModelController {
  /**
   * Listagem de modelos de IA cadastrados no MongoDB com mascaramento de segredos
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, limit, skip } = getPaginationParams(req, 10, 100);
      const search = (req.query.search as string)?.trim();
      const provider = req.query.provider as string;

      const where: any = {};
      if (provider) where.provider = provider;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { modelId: { contains: search, mode: 'insensitive' } },
        ];
      }

      let [total, models] = await Promise.all([
        prisma.aiModelConfig.count({ where }),
        prisma.aiModelConfig.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        }),
      ]);

      // Se a base de dados estiver vazia (primeira execução ou limpeza), provisiona os modelos oficiais automaticamente
      if (total === 0 && !search && !provider) {
        console.log('🤖 [ModelController] Nenhum modelo no banco. Provisionando modelos padrão oficiais...');
        await prisma.aiModelConfig.createMany({
          data: [
            {
              name: 'Google Gemini 3.5 Flash',
              provider: 'gemini',
              modelId: 'gemini-3.5-flash',
              isActive: true,
              isDefault: true,
              temperature: 0.2,
              maxTokens: 2048,
              description: 'Modelo multimodal de alta velocidade e precisão para auditoria da Res. CFM 2.336/2023.',
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
          ],
        });
        total = await prisma.aiModelConfig.count();
        models = await prisma.aiModelConfig.findMany({
          skip,
          take: limit,
          orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        });
      }

      // Mascaramento de chave de API para segurança (OWASP / T32)
      const sanitizedModels = models.map((m) => ({
        ...m,
        apiKey: maskApiKey(m.apiKey),
      }));

      res.status(200).json(buildPaginatedResponse(sanitizedModels, total, { page, limit, skip }));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Detalhes de um modelo por ID
   */
  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const model = await prisma.aiModelConfig.findUnique({ where: { id } });

      if (!model) {
        res.status(404).json({ error: 'Configuração de modelo não encontrada.', code: 'MODEL_NOT_FOUND' });
        return;
      }

      res.status(200).json({
        ...model,
        apiKey: maskApiKey(model.apiKey),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cadastro de novo modelo de IA
   */
  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = createModelSchema.parse(req.body);

      // Validação anti-SSRF em URLs de inferência customizadas (T26 / SEC-P1)
      if (data.baseUrl && data.baseUrl.trim().length > 0) {
        const isLoopback = isAllowedLocalhostBaseUrl(data.baseUrl.trim());
        if (!isLoopback) {
          const check = await validateSafeUrlAsync(data.baseUrl.trim());
          if (!check.safe) {
            res.status(400).json({
              error: `URL base de inferência rejeitada por segurança: ${check.reason}`,
              code: 'SSRF_INVALID_BASE_URL',
            });
            return;
          }
        }
      }

      // Se for marcado como ativo, desativa os outros modelos
      if (data.isActive) {
        await prisma.aiModelConfig.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
      }

      // T32: Cifragem em repouso da apiKey com AES-256-GCM
      const encryptedApiKey = encryptModelApiKey(data.apiKey);

      const model = await prisma.aiModelConfig.create({
        data: {
          name: data.name,
          provider: data.provider,
          modelId: data.modelId,
          baseUrl: data.baseUrl || null,
          apiKey: encryptedApiKey,
          temperature: data.temperature,
          maxTokens: data.maxTokens,
          description: data.description,
          isActive: data.isActive,
          isDefault: data.isDefault,
        },
      });

      if (model.isActive) {
        ReconciliationEngine.setActiveProvider(model.provider as any);
        ReconciliationEngine.invalidateModelCache();
      }

      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          message: `Novo modelo de IA cadastrado: ${model.name} (${model.provider}/${model.modelId})`,
          module: 'AI_MODELS_CRUD',
        },
      });

      res.status(201).json({
        ...model,
        apiKey: maskApiKey(model.apiKey),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Atualização de modelo existente
   */
  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const data = updateModelSchema.parse(req.body);

      const existing = await prisma.aiModelConfig.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: 'Modelo não encontrado para atualização.', code: 'MODEL_NOT_FOUND' });
        return;
      }

      if (data.baseUrl && data.baseUrl.trim().length > 0) {
        const isLoopback = isAllowedLocalhostBaseUrl(data.baseUrl.trim());
        if (!isLoopback) {
          const check = await validateSafeUrlAsync(data.baseUrl.trim());
          if (!check.safe) {
            res.status(400).json({
              error: `URL base de inferência rejeitada por segurança: ${check.reason}`,
              code: 'SSRF_INVALID_BASE_URL',
            });
            return;
          }
        }
      }

      if (data.isActive && !existing.isActive) {
        await prisma.aiModelConfig.updateMany({
          where: { id: { not: id }, isActive: true },
          data: { isActive: false },
        });
      }

      // Se não enviou apiKey ou enviou máscara, preserva a existente.
      // Se enviou nova apiKey, cifra em repouso com AES-256-GCM (T32)
      const updateData: any = { ...data };
      if (data.apiKey && data.apiKey.includes('••••')) {
        delete updateData.apiKey;
      } else if (data.apiKey !== undefined) {
        updateData.apiKey = encryptModelApiKey(data.apiKey);
      }

      const updated = await prisma.aiModelConfig.update({
        where: { id },
        data: updateData,
      });

      if (updated.isActive) {
        ReconciliationEngine.setActiveProvider(updated.provider as any);
      }
      ReconciliationEngine.invalidateModelCache();

      res.status(200).json({
        ...updated,
        apiKey: maskApiKey(updated.apiKey),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Exclusão de modelo de IA
   */
  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const model = await prisma.aiModelConfig.findUnique({ where: { id } });

      if (!model) {
        res.status(404).json({ error: 'Modelo não encontrado.', code: 'MODEL_NOT_FOUND' });
        return;
      }

      if (model.isActive) {
        res.status(400).json({
          error: 'Não é permitido excluir o modelo atualmente ativo no sistema. Ative outro modelo antes.',
          code: 'ACTIVE_MODEL_CANNOT_BE_DELETED',
        });
        return;
      }

      await prisma.aiModelConfig.delete({ where: { id } });
      ReconciliationEngine.invalidateModelCache();

      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          message: `Modelo de IA removido: ${model.name} (${model.provider}/${model.modelId})`,
          module: 'AI_MODELS_CRUD',
        },
      });

      res.status(200).json({ message: 'Modelo removido com sucesso.', id });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Ativação de modelo em tempo real (Runtime Model Switching)
   */
  public static async activate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const model = await prisma.aiModelConfig.findUnique({ where: { id } });

      if (!model) {
        res.status(404).json({ error: 'Modelo não encontrado.', code: 'MODEL_NOT_FOUND' });
        return;
      }

      // Desativa todos e ativa o selecionado
      const [_, updatedModel] = await prisma.$transaction([
        prisma.aiModelConfig.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        }),
        prisma.aiModelConfig.update({
          where: { id },
          data: { isActive: true },
        }),
      ]);

      ReconciliationEngine.setActiveProvider(model.provider as any);
      ReconciliationEngine.invalidateModelCache();

      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          message: `Modelo de IA ativado em runtime: ${model.name} (${model.provider}/${model.modelId})`,
          module: 'AI_MODELS_RUNTIME',
        },
      });

      res.status(200).json({
        message: `Modelo ${model.name} ativado com sucesso como motor ativo de auditoria.`,
        activeModel: updatedModel || { ...model, isActive: true },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Teste pontual de modelo por ID
   */
  public static async test(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const prompt = req.body?.prompt ? String(req.body.prompt).slice(0, 1000) : undefined;
      const result = await ReconciliationEngine.testModelResponse(prompt, id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
