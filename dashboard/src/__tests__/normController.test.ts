import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NormController } from '../controllers/normController.js';
import { prisma } from '../config/prisma.js';

// Mock do prisma para testes unitários isolados
vi.mock('../config/prisma.js', () => ({
  prisma: {
    norm: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    normChunk: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    scrapedPage: {
      count: vi.fn(),
    },
    violation: {
      findMany: vi.fn(),
    },
  },
}));

describe('NormController - Gestão e Auditoria das Coleções norms e norms_chunk', () => {
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      query: {},
      params: {},
      body: {},
      user: { role: 'ADMIN' },
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe('1. listNorms', () => {
    it('deve listar normas com paginação e filtros', async () => {
      req.query = { page: '1', limit: '10', tipo: 'RESOLUCAO', status: 'VIGENTE' };

      vi.mocked(prisma.norm.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.norm.findMany).mockResolvedValueOnce([
        {
          id: 'norm-1',
          normId: 'CFM-RES-2336-2023',
          tipo: 'RESOLUCAO',
          numero: '2336',
          ano: '2023',
          status: 'VIGENTE',
          ementaHigienizada: 'Diretrizes sobre publicidade médica',
          totalChunks: 12,
          tokensEstimados: 4500,
          tags: ['CFM', 'PUBLICIDADE'],
        } as any,
      ]);

      await NormController.listNorms(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ normId: 'CFM-RES-2336-2023' }),
        ]),
        pagination: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      });
    });
  });

  describe('2. getNormById', () => {
    it('deve retornar a norma com versões bruta e higienizada', async () => {
      req.params = { normId: 'CFM-RES-2336-2023' };

      vi.mocked(prisma.norm.findFirst).mockResolvedValueOnce({
        id: 'db-id-1',
        normId: 'CFM-RES-2336-2023',
        conteudoOriginalBruto: 'I - os rgos pblicos integrantes...',
        conteudoHigienizado: 'I - os órgãos públicos integrantes...',
        cleanMarkdown: '# CFM Resolução 2336/2023...',
        chunks: [
          {
            chunkIndex: 1,
            conteudoChunk: 'Chunk 1 com texto legal',
            tokensEstimados: 200,
            contextoSemantico: 'Ementa geral',
            tags: ['CFM'],
          },
        ],
      } as any);

      await NormController.getNormById(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: expect.objectContaining({
          normId: 'CFM-RES-2336-2023',
          conteudoOriginalBruto: expect.stringContaining('rgos pblicos'),
          conteudoHigienizado: expect.stringContaining('órgãos públicos'),
        }),
      });
      expect(prisma.norm.findFirst).toHaveBeenCalledWith({
        where: { normId: 'CFM-RES-2336-2023' },
      });
    });

    it('deve retornar 404 quando a norma não for encontrada', async () => {
      req.params = { normId: 'NORM-INEXISTENTE' };
      vi.mocked(prisma.norm.findFirst).mockResolvedValueOnce(null);

      await NormController.getNormById(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'NORM_NOT_FOUND' })
      );
    });
  });

  describe('3. getNormChunks', () => {
    it('deve retornar os chunks semânticos da norma com paginação', async () => {
      req.params = { normId: 'CFM-RES-2336-2023' };
      req.query = { page: '1', limit: '20' };

      vi.mocked(prisma.norm.findFirst).mockResolvedValueOnce({ id: 'db-id-1' } as any);
      vi.mocked(prisma.normChunk.count).mockResolvedValueOnce(2);
      vi.mocked(prisma.normChunk.findMany).mockResolvedValueOnce([
        {
          id: 'chunk-1',
          normId: 'CFM-RES-2336-2023',
          normCode: 'CFM-RES-2336-2023',
          chunkIndex: 1,
          conteudoChunk: 'Primeiro fragmento de texto...',
          tokensEstimados: 350,
          contextoSemantico: 'Introdução e ementa',
          tags: ['CFM'],
        } as any,
      ]);

      await NormController.getNormChunks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ chunkIndex: 1, tokensEstimados: 350 }),
        ]),
        pagination: {
          total: 2,
          page: 1,
          limit: 20,
          totalPages: 1,
        },
      });
      expect(prisma.normChunk.count).toHaveBeenCalledWith({ where: { normId: 'db-id-1' } });
      expect(prisma.normChunk.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { normId: 'db-id-1' } })
      );
    });

    it('deve retornar 404 sem consultar chunks quando a norma não existe', async () => {
      req.params = { normId: 'NORM-INEXISTENTE' };
      vi.mocked(prisma.norm.findFirst).mockResolvedValueOnce(null);

      await NormController.getNormChunks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'NORM_NOT_FOUND' })
      );
      expect(prisma.normChunk.count).not.toHaveBeenCalled();
    });
  });

  describe('4. getStatsSummary', () => {
    it('deve retornar sumário agregado de métricas das coleções norms, norms_chunk e scraped_pages', async () => {
      vi.mocked(prisma.norm.count)
        .mockResolvedValueOnce(3857) // totalNorms
        .mockResolvedValueOnce(3400) // vigentes
        .mockResolvedValueOnce(457); // revogadas

      vi.mocked(prisma.normChunk.count).mockResolvedValueOnce(28900); // totalChunks
      vi.mocked(prisma.scrapedPage.count).mockResolvedValueOnce(9); // totalScrapedPages

      await NormController.getStatsSummary(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        totalNorms: 3857,
        totalChunks: 28900,
        totalScrapedPages: 9,
        statusBreakdown: {
          vigentes: 3400,
          revogadas: 457,
        },
      });
    });
  });
});
