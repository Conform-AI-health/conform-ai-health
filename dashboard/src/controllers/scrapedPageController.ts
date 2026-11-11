import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { ScraperService } from '../services/scraperService.js';
import { validateSafeUrl, validateSafeUrlAsync } from '../shared/security.js';

const scrapeInputSchema = z.object({
  url: z.string().url('URL inválida'),
  mode: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL']).optional(),
  customTags: z.array(z.string()).optional(),
});

export class ScrapedPageController {
  /**
   * Executa a varredura da URL da norma/página, classifica tags regulatórias e persiste no MongoDB
   */
  public static async scrapeAndIndex(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { url, mode, customTags } = scrapeInputSchema.parse(req.body);

      // 1. Verificação de segurança contra SSRF e DNS Rebinding (SEC-02)
      const safeCheck = await validateSafeUrlAsync(url);
      if (!safeCheck.safe) {
        res.status(400).json({
          error: `URL rejeitada por política de segurança: ${safeCheck.reason}`,
          code: 'SSRF_SECURITY_VIOLATION',
        });
        return;
      }

      // 2. Execução do Web Scraping Inteligente (Multi-documentos, DOU in.gov.br, GitHub ou Página Única)
      const scrapeResults = await ScraperService.scrapeMultiDocOrSingle(url, customTags, mode);

      if (!scrapeResults || scrapeResults.length === 0) {
        throw new Error('Nenhum conteúdo ou documento regulatório pôde ser extraído da URL fornecida.');
      }

      const isBatch = scrapeResults.length > 1;

      // 3. Persistência de CADA documento individualmente no MongoDB (scraped_pages)
      const savedDocs = [];
      for (const item of scrapeResults) {
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

        console.log(`📄 [SCRAPER] Documento individual indexado no MongoDB: "${doc.title}" (${doc.url}) | Tokens: ${doc.tokensCount} | Tags: [${doc.tags.join(', ')}]`);
      }

      // 4. Registro de Log do Sistema / Telemetria
      if (isBatch) {
        await prisma.systemLog.create({
          data: {
            level: 'INFO',
            message: `Varredura de repositório/portal concluída: ${savedDocs.length} normas/atos indexados individualmente no MongoDB (${url}).`,
            module: 'SCRAPER_BATCH',
            correlationId: savedDocs[0]?.id || null,
          },
        });
      } else {
        await prisma.systemLog.create({
          data: {
            level: 'INFO',
            message: `Norma/Página varrida e indexada no MongoDB com tags: [${savedDocs[0]?.tags?.join(', ')}] (${savedDocs[0]?.title})`,
            module: 'SCRAPER_TAGGING',
            correlationId: savedDocs[0]?.id || null,
          },
        });
      }

      res.status(201).json({
        message: isBatch
          ? `Varredura concluída com sucesso! ${savedDocs.length} normas/documentos foram extraídos e indexados individualmente no MongoDB.`
          : 'Norma/Página varrida e indexada com sucesso!',
        isBatch,
        totalIndexed: savedDocs.length,
        page: savedDocs[0],
        pages: savedDocs,
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

      const isClient = req.user?.role === 'CLIENT';
      const agentWhere: any = {
        enabled: true,
        ...(isClient
          ? {
              OR: [
                { clientId: null },
                ...(req.user?.clientId ? [{ clientId: req.user.clientId }] : []),
              ],
            }
          : {}),
      };

      const allAgents = await prisma.agentModule.findMany({
        where: agentWhere,
      });

      // Filtra agentes cujo array de tags possui interseção com as tags da página
      // Higienização de segurança (SEC-03): não vaza systemPrompt ou regras internas
      const sanitizedAgents = allAgents
        .filter((agent) => {
          const agentTags = agent.tags || ['CFM'];
          return agentTags.some((t) => page.tags.includes(t));
        })
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          code: agent.code,
          description: agent.description,
          tags: agent.tags,
          enabled: agent.enabled,
        }));

      res.status(200).json({
        pageId: page.id,
        pageUrl: page.url,
        pageTags: page.tags,
        compatibleAgents: sanitizedAgents,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Upload direto de documento local (PDF, Markdown ou TXT) para indexação no MongoDB
   */
  public static async uploadAndIndex(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const uploadSchema = z.object({
        filename: z.string().min(1, 'Nome do arquivo é obrigatório'),
        fileBase64: z.string().min(1, 'Conteúdo do arquivo em base64 é obrigatório'),
        customTags: z.array(z.enum(['CFM', 'LGPD', 'ANVISA', 'ANS'])).optional(),
      });

      const { filename, fileBase64, customTags } = uploadSchema.parse(req.body);

      const buffer = Buffer.from(fileBase64, 'base64');
      const isPdf = filename.toLowerCase().endsWith('.pdf') || buffer.subarray(0, 5).toString('ascii').startsWith('%PDF');

      let cleanMarkdown = '';
      let title = filename.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
      title = title.charAt(0).toUpperCase() + title.slice(1);
      let totalPages = 1;

      if (isPdf) {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: buffer });
        const textResult = await parser.getText();
        const extractedText = textResult.text || '';
        totalPages = textResult.total || 1;

        try {
          const infoResult = await parser.getInfo();
          if (infoResult?.info?.Title && typeof infoResult.info.Title === 'string' && infoResult.info.Title.trim().length > 3) {
            title = infoResult.info.Title.trim();
          }
        } catch (e) {}

        await parser.destroy();

        const cleanLines = extractedText
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        cleanMarkdown = [
          `# ${title}`,
          '',
          `- **Fonte:** Upload Direto de Documento Regulatório (${filename})`,
          `- **Formato:** Arquivo PDF Oficial (${totalPages} página${totalPages > 1 ? 's' : ''})`,
          `- **Tamanho:** ${Math.round(buffer.length / 1024)} KB`,
          '',
          '---',
          '',
          '## Conteúdo Integral do Documento Regulatório',
          cleanLines.join('\n\n'),
        ].join('\n').trim();
      } else {
        // Markdown ou TXT
        cleanMarkdown = buffer.toString('utf-8');
      }

      const detectedTags = ScraperService.detectRegulatoryTags(cleanMarkdown, cleanMarkdown);
      const effectiveTags = Array.from(new Set([...(customTags || []), ...detectedTags]));
      const extractedEntities = ScraperService.extractEntities(cleanMarkdown, cleanMarkdown);

      const tokensEstimatedRaw = Math.ceil(buffer.length / 4);
      const tokensEstimatedClean = Math.ceil(cleanMarkdown.length / 4);

      const virtualUrl = `upload://${encodeURIComponent(filename.replace(/\s+/g, '_'))}`;

      const savedDoc = await prisma.scrapedPage.upsert({
        where: { url: virtualUrl },
        update: {
          title,
          cleanMarkdown,
          rawLength: buffer.length,
          tokensCount: tokensEstimatedClean,
          tags: effectiveTags,
          extractedEntities: JSON.stringify(extractedEntities),
        },
        create: {
          url: virtualUrl,
          title,
          cleanMarkdown,
          rawLength: buffer.length,
          tokensCount: tokensEstimatedClean,
          tags: effectiveTags,
          extractedEntities: JSON.stringify(extractedEntities),
        },
      });

      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          message: `Documento enviado via upload e indexado com sucesso no MongoDB: "${savedDoc.title}" (${filename})`,
          module: 'SCRAPER_UPLOAD',
          correlationId: savedDoc.id,
        },
      });

      res.status(201).json({
        message: 'Arquivo enviado e indexado com sucesso no MongoDB!',
        isBatch: false,
        totalIndexed: 1,
        page: savedDoc,
        pages: [savedDoc],
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
