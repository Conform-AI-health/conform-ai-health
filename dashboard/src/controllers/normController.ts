import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { NORMS_CATALOG } from '../data/normsCatalog.js';
import { Role } from '@prisma/client';

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
   * Retorna uma norma completa com versões original bruta e higienizada
   */
  public static async getNormById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { normId } = req.params;

      const norm = await prisma.norm.findFirst({
        where: {
          OR: [{ normId }, { id: normId }],
        },
        include: {
          chunks: {
            take: 10,
            select: {
              chunkIndex: true,
              conteudoChunk: true,
              tokensEstimados: true,
              contextoSemantico: true,
              tags: true,
            },
          },
        },
      });

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

      const [total, chunks] = await Promise.all([
        prisma.normChunk.count({ where: { normId } }),
        prisma.normChunk.findMany({
          where: { normId },
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
