import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { NORMS_CATALOG } from '../data/normsCatalog.js';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { LegalNormCrawlerService, CrawlJobState } from '../services/legalNormCrawlerService.js';
import { NormsResolver } from '../services/normsResolver.js';
import { AIInvocationCacheService } from '../services/ai/aiInvocationCache.js';
import { validateSafeUrlAsync } from '../shared/security.js';
import { env } from '../config/env.js';
import { normCrawlQueue } from '../config/redis.js';
import { AIProviderFactory } from '../services/ai/aiProviderFactory.js';
import { OllamaTaxonomyService } from '../services/ollamaTaxonomyService.js';
import { TaxonomyInferenceInput } from '../services/deontologicalTaxonomyService.js';
import { injectTraceCarrier } from '../shared/tracing.js';

const crawlInputSchema = z.object({
  url: z.string().url('URL inválida'),
  maxDepth: z.number().int().min(0).max(4).optional(),
  maxPages: z.number().int().min(1).max(50000).optional(),
  tags: z.array(z.string()).optional(),
  allowedDomains: z.array(z.string()).optional(),
  force: z.boolean().optional(),
  preferFirecrawl: z.boolean().optional(),
});

const searchInputSchema = z.object({
  query: z.string().min(2),
  topK: z.number().int().min(1).max(25).optional(),
  filters: z
    .object({
      norm_type: z.string().optional(),
      year: z.union([z.string(), z.number()]).optional(),
      status: z.string().optional(),
      tag: z.string().optional(),
    })
    .optional(),
});

const isMongoObjectId = /^[a-f\d]{24}$/i;

export class NormController {
  /**
   * Catálogo legado/estático para retrocompatibilidade
   */
  public static async listCatalog(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json({
        total: NORMS_CATALOG.length,
        norms: NORMS_CATALOG,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Regras e infrações ativas para clientes específicos
   */
  public static async customerRules(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let clientId = req.query.clientId as string;

      if (req.user?.role === Role.CLIENT) {
        clientId = req.user.clientId || '';
      }

      if (!clientId) {
        res.status(400).json({
          error: 'Parâmetro clientId é obrigatório.',
          code: 'CLIENT_ID_REQUIRED',
        });
        return;
      }

      const violations = await prisma.violation.findMany({
        where: {
          auditReport: { clientId },
        },
        select: {
          normCode: true,
          normArticle: true,
          severity: true,
          resolved: true,
          createdAt: true,
        },
      });

      const activeRules = NORMS_CATALOG.map((norm) => {
        const matchingViolations = violations.filter(
          (v) => (v.normCode && v.normCode.includes(norm.normCode)) || v.normArticle === norm.article
        );
        const unresolvedCount = matchingViolations.filter((v) => !v.resolved).length;
        return {
          ...norm,
          totalOccurrences: matchingViolations.length,
          unresolvedOccurrences: unresolvedCount,
          status: unresolvedCount > 0 ? 'ATENCAO' : 'CONFORME',
        };
      });

      res.status(200).json({
        clientId,
        rules: activeRules,
        totalTrackedNorms: NORMS_CATALOG.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retorna todas as tags distintas presentes nos documentos da coleção 'norms', com respectiva contagem
   */
  public static async listDistinctTags(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // 1. Tenta agregação nativa do MongoDB para contagem e agrupamento de tags distintas
      let tags: Array<{ tag: string; count: number }> = [];
      try {
        const results = (await prisma.norm.aggregateRaw({
          pipeline: [
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
          ],
        })) as unknown as Array<{ _id: string; count: number }>;

        if (Array.isArray(results) && results.length > 0) {
          tags = results
            .map((item) => ({
              tag: typeof item._id === 'string' ? item._id.trim() : String(item._id || '').trim(),
              count: typeof item.count === 'number' ? item.count : 1,
            }))
            .filter((item) => item.tag.length > 0);
        }
      } catch (aggErr) {
        // Fallback seguro usando findMany caso o driver não autorize aggregateRaw
        const normsWithTags = await prisma.norm.findMany({
          select: { tags: true },
        });
        const counts = new Map<string, number>();
        for (const n of normsWithTags) {
          if (Array.isArray(n.tags)) {
            for (const t of n.tags) {
              const clean = typeof t === 'string' ? t.trim() : '';
              if (clean) counts.set(clean, (counts.get(clean) || 0) + 1);
            }
          }
        }
        tags = Array.from(counts.entries())
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count);
      }

      res.status(200).json({
        total: tags.length,
        tags,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Listagem paginada da coleção mestre 'norms' com filtros dinâmicos
   */
  public static async listNorms(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const search = (req.query.search as string)?.trim();
      const orgao = (req.query.orgao as string)?.trim();
      const tipo = (req.query.tipo as string)?.trim();
      const status = (req.query.status as string)?.trim();
      const ano = (req.query.ano as string)?.trim();
      const tag = (req.query.tag as string)?.trim();
      const hasEmbeddingsParam = (req.query.hasEmbeddings as string)?.trim().toLowerCase();
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));

      const where: any = {};

      if (orgao) where.orgao = { equals: orgao, mode: 'insensitive' };
      if (tipo) where.tipo = { equals: tipo, mode: 'insensitive' };
      if (status) where.status = { equals: status, mode: 'insensitive' };
      if (ano) where.ano = ano;
      if (tag) {
        where.tags = { hasSome: [tag, tag.toUpperCase(), tag.toLowerCase()] };
      }

      if (hasEmbeddingsParam === 'true') {
        where.tags = where.tags ? { ...where.tags, has: 'RAG_READY' } : { has: 'RAG_READY' };
      } else if (hasEmbeddingsParam === 'false') {
        where.NOT = { tags: { has: 'RAG_READY' } };
      }

      if (search) {
        where.OR = [
          { normId: { contains: search, mode: 'insensitive' } },
          { ementaHigienizada: { contains: search, mode: 'insensitive' } },
          { cleanMarkdown: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [total, norms] = await Promise.all([
        prisma.norm.count({ where }),
        prisma.norm.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: [{ ano: 'desc' }, { numero: 'desc' }],
          select: {
            id: true,
            normId: true,
            idNormaCfm: true,
            orgao: true,
            tipo: true,
            numero: true,
            ano: true,
            status: true,
            dataPublicacao: true,
            ementaHigienizada: true,
            macroTema: true,
            urlOriginal: true,
            urlPdfOriginal: true,
            totalChunks: true,
            tokensEstimados: true,
            tags: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ]);

      // Enriquecimento com verificação física de chunks e embeddings para cada norma
      const normIds = norms.map((n) => n.id);
      const rawChunks = normIds.length > 0
        ? await prisma.normChunk.findMany({
            where: { normId: { in: normIds } },
            select: {
              id: true,
              normId: true,
              embedding: true,
              contextoSemantico: true,
            },
          })
        : [];
      const chunks = Array.isArray(rawChunks) ? rawChunks : [];

      const statsByNormId = new Map<string, { total: number; indexed: number }>();
      for (const chunk of chunks) {
        const stats = statsByNormId.get(chunk.normId) || { total: 0, indexed: 0 };
        stats.total += 1;
        const hasVector = Array.isArray(chunk.embedding) && chunk.embedding.length > 0;
        if (hasVector) {
          stats.indexed += 1;
        }
        statsByNormId.set(chunk.normId, stats);
      }

      const enrichedNorms = norms.map((norm) => {
        const stats = statsByNormId.get(norm.id) || {
          total: norm.totalChunks || 0,
          indexed: norm.tags?.includes('RAG_READY') ? norm.totalChunks || 0 : 0,
        };
        const totalChunks = Math.max(norm.totalChunks || 0, stats.total);
        const indexedChunks = stats.indexed;
        const hasEmbeddings = indexedChunks > 0 || (norm.tags?.includes('RAG_READY') && totalChunks > 0);
        const embeddingStatus =
          (totalChunks > 0 && indexedChunks >= totalChunks) || (norm.tags?.includes('RAG_READY') && indexedChunks > 0)
            ? 'FULL'
            : indexedChunks > 0
            ? 'PARTIAL'
            : 'NONE';

        return {
          ...norm,
          totalChunks,
          indexedChunks,
          hasEmbeddings,
          embeddingStatus,
        };
      });

      res.status(200).json({
        data: enrichedNorms,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retorna uma norma com versões original bruta e higienizada
   */
  public static async getNormById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { normId } = req.params;
      let norm = await prisma.norm.findFirst({
        where: { normId },
      });

      if (!norm && isMongoObjectId.test(normId)) {
        norm = await prisma.norm.findFirst({
          where: { id: normId },
        });
      }

      if (!norm) {
        res.status(404).json({
          error: `Norma não encontrada para o identificador: ${normId}`,
          code: 'NORM_NOT_FOUND',
        });
        return;
      }

      res.status(200).json({ data: norm });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retorna os chunks semânticos da norma com paginação
   */
  public static async getNormChunks(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { normId } = req.params;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      let norm = await prisma.norm.findFirst({
        where: { normId },
        select: { id: true },
      });

      if (!norm && isMongoObjectId.test(normId)) {
        norm = await prisma.norm.findFirst({
          where: { id: normId },
          select: { id: true },
        });
      }

      if (!norm) {
        res.status(404).json({
          error: `Norma não encontrada para o identificador: ${normId}`,
          code: 'NORM_NOT_FOUND',
        });
        return;
      }

      const where = { normId: norm.id };

      const [total, chunks] = await Promise.all([
        prisma.normChunk.count({ where }),
        prisma.normChunk.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { chunkIndex: 'asc' },
          select: {
            id: true,
            normId: true,
            normCode: true,
            chunkIndex: true,
            conteudoChunk: true,
            tokensEstimados: true,
            contextoSemantico: true,
            tags: true,
            createdAt: true,
            // O embedding é omitido por padrão no list para economizar payload, mas incluído se flag solicitada
            ...(req.query.includeEmbedding === 'true' ? { embedding: true } : {}),
          },
        }),
      ]);

      res.status(200).json({
        data: chunks,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retorna sumário consolidado de métricas da base normativa e de RAG
   */
  /**
   * POST /norms/crawl — inicia o crawl de normas em segundo plano e devolve o jobId (202).
   * Cada link descoberto/visitado é rastreado na telemetria (aba "Links Consultados").
   */
  public static async startCrawlJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = crawlInputSchema.parse(req.body);

      const safeCheck = await validateSafeUrlAsync(input.url);
      if (!safeCheck.safe) {
        res.status(400).json({
          error: `URL rejeitada por política de segurança: ${safeCheck.reason}`,
          code: 'SSRF_SECURITY_VIOLATION',
        });
        return;
      }

      const jobId = `crawl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const crawlPayload = {
        ...input,
        maxPages: input.maxPages ?? env.CRAWL_MAX_PAGES,
        jobId,
        traceContext: injectTraceCarrier(),
      };

      // Inicializa e persiste estado preliminar do job no Redis/Memória
      const initialJobState: CrawlJobState = {
        jobId,
        rootUrl: input.url,
        status: 'running',
        maxDepth: input.maxDepth ?? 2,
        allowedDomains: input.allowedDomains || [],
        tags: input.tags || [],
        force: input.force === true,
        counters: {
          discovered: 1,
          downloaded: 0,
          normsSaved: 0,
          normsSkippedIdempotent: 0,
          normsUpdatedVersion: 0,
          discarded: 0,
          errors: 0,
        },
        savedNormIds: [],
        discards: [],
        errors: [],
        startedAt: new Date().toISOString(),
      };
      await LegalNormCrawlerService.saveJobState(initialJobState);

      // Desacoplamento assíncrono: enfileira no BullMQ para processamento pelo Worker com 1 única tentativa (sem retry automático de 3x)
      try {
        await normCrawlQueue.add('normCrawlJob', crawlPayload, {
          jobId: `norm-crawl-${jobId}`,
          attempts: 1,
        });
        console.log(`📬 [NormController] Job de crawl de normas enfileirado no BullMQ: norm-crawl-${jobId}`);
      } catch (queueErr: any) {
        console.warn(`⚠️ [NormController] Redis em fallback (${queueErr.message}). Executando crawl diretamente...`);
        void LegalNormCrawlerService.executeCrawlJob(crawlPayload).catch((err: any) => {
          console.error(`❌ [Crawl ${jobId}] Falha geral do job: ${err.message}`);
        });
      }

      res.status(202).json({
        message: 'Varredura iniciada na fila assíncrona. Acompanhe cada link consultado na aba "Links Consultados" da telemetria.',
        jobId,
        statusUrl: `/norms/crawl/${jobId}`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /norms/crawl/:jobId — estado e contadores do job de crawl
   */
  public static async getCrawlJobStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const job = await LegalNormCrawlerService.getJob(req.params.jobId);
      if (!job) {
        res.status(404).json({ error: 'Job de crawl não encontrado ou expirado.' });
        return;
      }
      res.status(200).json(job);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /norms/search — busca vetorial nos chunks (apenas normas VIGENTES por padrão)
   */
  public static async searchNormsVector(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = searchInputSchema.parse(req.body);
      const results = await LegalNormCrawlerService.searchNormChunksVector(input);
      res.status(200).json({ data: results, total: results.length });
    } catch (error) {
      next(error);
    }
  }

  public static async getStatsSummary(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const [totalNorms, totalChunks, totalScrapedPages, vigentes, revogadas] = await Promise.all([
        prisma.norm.count(),
        prisma.normChunk.count(),
        prisma.scrapedPage.count(),
        prisma.norm.count({ where: { status: 'VIGENTE' } }),
        prisma.norm.count({ where: { status: 'REVOGADA' } }),
      ]);

      res.status(200).json({
        totalNorms,
        totalChunks,
        totalScrapedPages,
        statusBreakdown: {
          vigentes,
          revogadas,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /norms/:normId/generate-tags
   * Gera e aplica tags e macro-tema com o modelo de IA ativo (ou Ollama) com política --clean e persistência --apply
   */
  public static async generateThematicTags(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawNormId = (req.params.normId || '').trim();
      if (!rawNormId) {
        res.status(400).json({ error: 'Parâmetro normId obrigatório.' });
        return;
      }

      // Busca a norma pelo id ObjectId ou pelo código canônico normId
      const whereClause = isMongoObjectId.test(rawNormId)
        ? { OR: [{ id: rawNormId }, { normId: rawNormId }] }
        : { normId: rawNormId };

      const norm = await prisma.norm.findFirst({
        where: whereClause,
      });

      if (!norm) {
        res.status(404).json({ error: `Norma não encontrada no acervo: "${rawNormId}".` });
        return;
      }

      // 1. Identifica a configuração do modelo de IA atualmente ativo no sistema
      let activeModel: any = null;
      try {
        activeModel = await AIProviderFactory.getActiveModelConfig();
      } catch (err) {
        console.warn('[NormController] Não foi possível carregar modelo ativo da factory:', err);
      }

      // 2. Prepara o input da norma com a lógica de --clean (currentTags vazio para recalcular sem resquício)
      const input: TaxonomyInferenceInput = {
        normId: norm.normId,
        orgao: norm.orgao,
        tipo: norm.tipo,
        numero: norm.numero,
        ano: norm.ano,
        ementa: norm.ementaHigienizada,
        content: norm.cleanMarkdown,
        currentTags: [], // Lógica --clean
        status: norm.status,
      };

      // 3. Executa a inferência com Ollama / IA ativa
      const ollamaOptions = {
        baseUrl: activeModel?.baseUrl || env.OLLAMA_BASE_URL,
        modelId: activeModel?.provider === 'ollama' ? activeModel.modelId : env.OLLAMA_MODEL,
        temperature: activeModel?.temperature ?? 0.1,
      };

      const result = await OllamaTaxonomyService.inferTags(input, ollamaOptions);

      // 4. Persiste a alteração no MongoDB (Lógica --apply)
      const updatedNorm = await prisma.norm.update({
        where: { id: norm.id },
        data: {
          tags: result.allTags,
          macroTema: result.macroTema,
          status: result.statusTag,
        },
        select: {
          id: true,
          normId: true,
          tags: true,
          macroTema: true,
          status: true,
          updatedAt: true,
        },
      });

      NormsResolver.invalidateCache();
      await AIInvocationCacheService.invalidateAll('norm_tags_updated');

      res.status(200).json({
        success: true,
        normId: updatedNorm.normId,
        tags: updatedNorm.tags,
        macroTema: updatedNorm.macroTema,
        status: updatedNorm.status,
        thematicTags: result.thematicTags,
        confidence: result.confidence,
        reasoning: result.reasoning,
        provider: result.provider,
        modelUsed: result.modelUsed,
        updatedAt: updatedNorm.updatedAt,
      });
    } catch (error) {
      next(error);
    }
  }
}
