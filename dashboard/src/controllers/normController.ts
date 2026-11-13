import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { NORMS_CATALOG } from '../data/normsCatalog.js';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { LegalNormCrawlerService } from '../services/legalNormCrawlerService.js';
import { validateSafeUrlAsync } from '../shared/security.js';
import { env } from '../config/env.js';

const crawlInputSchema = z.object({
  url: z.string().url('URL inválida'),
  maxDepth: z.number().int().min(0).max(4).optional(),
  maxPages: z.number().int().min(1).max(500).optional(),
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
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));

      const where: any = {};

      if (orgao) where.orgao = { equals: orgao, mode: 'insensitive' };
      if (tipo) where.tipo = { equals: tipo, mode: 'insensitive' };
      if (status) where.status = { equals: status, mode: 'insensitive' };
      if (ano) where.ano = ano;
      if (tag) where.tags = { has: tag };

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

      res.status(200).json({
        data: norms,
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
      void LegalNormCrawlerService.executeCrawlJob({
        ...input,
        maxPages: input.maxPages ?? env.CRAWL_MAX_PAGES,
        jobId,
      }).catch((err: any) => {
        console.error(`❌ [Crawl ${jobId}] Falha geral do job: ${err.message}`);
      });

      res.status(202).json({
        message: 'Varredura iniciada. Acompanhe cada link consultado na aba "Links Consultados" da telemetria.',
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
      const job = LegalNormCrawlerService.getJob(req.params.jobId);
      if (!job) {
        res.status(404).json({ error: 'Job de crawl não encontrado (jobs são mantidos em memória).' });
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
}
