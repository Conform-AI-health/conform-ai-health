import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { ScraperService } from '../services/scraperService.js';
import { validateSafeUrl } from '../shared/security.js';

const scrapeInputSchema = z.object({
  url: z.string().url('URL inválida'),
  mode: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL']).optional(),
  customTags: z.array(z.enum(['CFM', 'LGPD', 'ANVISA', 'ANS'])).optional(),
});

export class ScrapedPageController {
  /**
   * Executa a varredura da URL da norma/página, classifica tags regulatórias e persiste no MongoDB
   */
  public static async scrapeAndIndex(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { url, mode, customTags } = scrapeInputSchema.parse(req.body);

      // 1. Verificação de segurança contra SSRF
      const safeCheck = validateSafeUrl(url);
      if (!safeCheck.safe) {
        res.status(400).json({
          error: `URL rejeitada por política de segurança: ${safeCheck.reason}`,
          code: 'SSRF_SECURITY_VIOLATION',
        });
        return;
      }

      // 2. Execução do Web Scraping (detecção automática de diretório GitHub vs página única)
      const treeCheck = ScraperService.isGitHubTreeUrl(url);

      if (treeCheck.isTree) {
        const batchResults = await ScraperService.scrapeGitHubTree(url, customTags);

        const savedDocs = [];
        for (const item of batchResults) {
          const effectiveTags = Array.from(
            new Set([...(customTags || []), ...item.detectedTags])
          );

          const doc = await prisma.scrapedPage.upsert({
            where: { url: item.url },
            update: {
              title: item.title,
              cleanMarkdown: item.cleanMarkdown,
              rawLength: item.rawHtmlLength,
              tokensCount: item.tokensEstimatedClean,
              tags: effectiveTags,
              extractedEntities: JSON.stringify(item.extractedEntities),
            },
            create: {
              url: item.url,
              title: item.title,
              cleanMarkdown: item.cleanMarkdown,
              rawLength: item.rawHtmlLength,
              tokensCount: item.tokensEstimatedClean,
              tags: effectiveTags,
              extractedEntities: JSON.stringify(item.extractedEntities),
            },
          });
          savedDocs.push(doc);
        }

        // Registro de log em lote
        await prisma.systemLog.create({
          data: {
            level: 'INFO',
            message: `Varredura de diretório GitHub concluída: ${savedDocs.length} normas/documentos indexados individualmente no MongoDB Atlas (${treeCheck.owner}/${treeCheck.repo}/${treeCheck.path}).`,
            module: 'SCRAPER_BATCH',
            correlationId: savedDocs[0]?.id || null,
          },
        });

        res.status(201).json({
          message: `Varredura em lote concluída com sucesso! ${savedDocs.length} documentos indexados no MongoDB.`,
          isBatch: true,
          totalIndexed: savedDocs.length,
          page: savedDocs[0],
          pages: savedDocs,
        });
        return;
      }

      // Fluxo de Página Única
      const scrapeResult = await ScraperService.scrape(url, mode);

      // 3. Consolidação das Tags Regulatórias
      const effectiveTags = Array.from(
        new Set([...(customTags || []), ...scrapeResult.detectedTags])
      );

      // 4. Persistência no MongoDB (upsert por URL)
      const scrapedDoc = await prisma.scrapedPage.upsert({
        where: { url },
        update: {
          title: scrapeResult.title,
          cleanMarkdown: scrapeResult.cleanMarkdown,
          rawLength: scrapeResult.rawHtmlLength,
          tokensCount: scrapeResult.tokensEstimatedClean,
          tags: effectiveTags,
          extractedEntities: JSON.stringify(scrapeResult.extractedEntities),
        },
        create: {
          url,
          title: scrapeResult.title,
          cleanMarkdown: scrapeResult.cleanMarkdown,
          rawLength: scrapeResult.rawHtmlLength,
          tokensCount: scrapeResult.tokensEstimatedClean,
          tags: effectiveTags,
          extractedEntities: JSON.stringify(scrapeResult.extractedEntities),
        },
      });

      // 5. Registro de Log do Sistema
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          message: `Norma/Página varrida e indexada no MongoDB com tags: [${effectiveTags.join(', ')}] (${scrapedDoc.title})`,
          module: 'SCRAPER_TAGGING',
          correlationId: scrapedDoc.id,
        },
      });

      res.status(201).json({
        message: 'Norma/Página varrida e indexada com sucesso!',
        isBatch: false,
        totalIndexed: 1,
        page: scrapedDoc,
        pages: [scrapedDoc],
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Listagem de normas e páginas raspadas no MongoDB com filtro por tag
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tag = req.query.tag as string;
      const page = req.query.page ? Math.max(1, parseInt(req.query.page as string, 10) || 1) : null;
      const limit = req.query.limit ? Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10)) : null;

      const where: any = {};
      if (tag) where.tags = { has: tag };

      if (page || limit || req.query.paginate === 'true') {
        const effectivePage = page || 1;
        const effectiveLimit = limit || 10;
        const [total, pages] = await Promise.all([
          prisma.scrapedPage.count({ where }),
          prisma.scrapedPage.findMany({
            where,
            skip: (effectivePage - 1) * effectiveLimit,
            take: effectiveLimit,
            orderBy: { createdAt: 'desc' },
          }),
        ]);

        res.status(200).json({
          data: pages,
          pagination: {
            total,
            page: effectivePage,
            limit: effectiveLimit,
            totalPages: Math.ceil(total / effectiveLimit),
          },
        });
        return;
      }

      const pages = await prisma.scrapedPage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      res.status(200).json(pages);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Detalhes de uma norma/página raspada
   */
  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const page = await prisma.scrapedPage.findUnique({
        where: { id },
      });

      if (!page) {
        res.status(404).json({ error: 'Norma/Página raspada não encontrada.' });
        return;
      }

      res.status(200).json(page);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Busca agentes cujo contexto de tags seja compatível com as tags desta norma/página
   */
  public static async getCompatibleAgents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const page = await prisma.scrapedPage.findUnique({
        where: { id },
      });

      if (!page) {
        res.status(404).json({ error: 'Página não encontrada.' });
        return;
      }

      const allAgents = await prisma.agentModule.findMany({
        where: { enabled: true },
      });

      // Filtra agentes cujo array de tags possui interseção com as tags da página
      const compatibleAgents = allAgents.filter((agent) => {
        const agentTags = agent.tags || ['CFM'];
        return agentTags.some((t) => page.tags.includes(t));
      });

      res.status(200).json({
        pageId: page.id,
        pageUrl: page.url,
        pageTags: page.tags,
        compatibleAgents,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Exclusão de documento da base de normas
   */
  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const page = await prisma.scrapedPage.findUnique({ where: { id } });

      if (!page) {
        res.status(404).json({ error: 'Documento não encontrado.' });
        return;
      }

      await prisma.scrapedPage.delete({ where: { id } });
      res.status(200).json({ message: 'Documento removido da base com sucesso.' });
    } catch (error) {
      next(error);
    }
  }
}
