import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getPaginationParams, buildPaginatedResponse } from '../shared/pagination.js';
import { ModelService } from '../services/modelService.js';

const modelFieldsSchema = z.object({
  name: z.string().min(2, 'Nome do modelo é obrigatório'),
  provider: z.enum(['gemini', 'ollama', 'heuristic'], {
    errorMap: () => ({ message: 'Provedor deve ser gemini, ollama ou heuristic' }),
  }),
  modelId: z.string().min(2, 'Identificador técnico do modelo é obrigatório (ex: gemini-2.0-flash, qwen2.5:7b)'),
  baseUrl: z.string().optional().nullable().or(z.literal('')),
  apiKey: z.string().optional().nullable().or(z.literal('')),
  temperature: z.coerce.number().min(0).max(2),
  maxTokens: z.coerce.number().min(128).max(32768),
  description: z.string().optional().nullable().or(z.literal('')),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

const createModelSchema = modelFieldsSchema.extend({
  temperature: modelFieldsSchema.shape.temperature.default(0.2),
  maxTokens: modelFieldsSchema.shape.maxTokens.default(2048),
  isActive: modelFieldsSchema.shape.isActive.default(false),
  isDefault: modelFieldsSchema.shape.isDefault.default(false),
});

const updateModelSchema = modelFieldsSchema.partial();

export class ModelController {
  /**
   * Listagem de modelos de IA cadastrados no MongoDB com mascaramento de segredos
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, limit, skip } = getPaginationParams(req, 10, 100);
      const search = (req.query.search as string)?.trim();
      const provider = req.query.provider as string;

      const { models, total } = await ModelService.listModels({
        page,
        limit,
        skip,
        search,
        provider,
      });

      res.status(200).json(buildPaginatedResponse(models, total, { page, limit, skip }));
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
      const model = await ModelService.getModelById(id);

      if (!model) {
        res.status(404).json({ error: 'Configuração de modelo não encontrada.', code: 'MODEL_NOT_FOUND' });
        return;
      }

      res.status(200).json(model);
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
      const created = await ModelService.createModel(data);

      res.status(201).json(created);
    } catch (error: any) {
      if (error.message?.includes('URL base de inferência rejeitada')) {
        res.status(400).json({ error: error.message, code: 'SSRF_INVALID_BASE_URL' });
        return;
      }
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
      const updated = await ModelService.updateModel(id, data);

      res.status(200).json({
        message: 'Configuração do modelo atualizada com sucesso.',
        model: updated,
      });
    } catch (error: any) {
      if (error.message === 'MODEL_NOT_FOUND') {
        res.status(404).json({ error: 'Modelo não encontrado para atualização.', code: 'MODEL_NOT_FOUND' });
        return;
      }
      if (error.message?.includes('URL base de inferência rejeitada')) {
        res.status(400).json({ error: error.message, code: 'SSRF_INVALID_BASE_URL' });
        return;
      }
      next(error);
    }
  }

  /**
   * Exclusão de modelo de IA
   */
  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await ModelService.deleteModel(id);

      res.status(200).json({
        message: 'Modelo de inteligência artificial removido com sucesso.',
      });
    } catch (error: any) {
      if (error.message === 'MODEL_NOT_FOUND') {
        res.status(404).json({ error: 'Modelo não encontrado.', code: 'MODEL_NOT_FOUND' });
        return;
      }
      if (error.message === 'CANNOT_DELETE_ACTIVE_MODEL') {
        res.status(400).json({
          error: 'Não é permitido excluir o modelo atualmente ativo no sistema. Ative outro modelo antes de excluir este.',
          code: 'ACTIVE_MODEL_CANNOT_BE_DELETED',
        });
        return;
      }
      next(error);
    }
  }

  /**
   * Ativação de modelo em tempo real (Runtime Model Switching)
   */
  public static async activate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const activated = await ModelService.activateModel(id);

      res.status(200).json({
        message: `Modelo ${activated.name} ativado com sucesso como motor ativo de auditoria.`,
        activeModel: activated,
      });
    } catch (error: any) {
      if (error.message === 'MODEL_NOT_FOUND') {
        res.status(404).json({ error: 'Modelo não encontrado.', code: 'MODEL_NOT_FOUND' });
        return;
      }
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
      const result = await ModelService.testModel(id, prompt);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
