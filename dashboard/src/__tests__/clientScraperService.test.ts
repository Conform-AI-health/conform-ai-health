import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientScraperService } from '../services/clientScraperService.js';
import { FirecrawlService } from '../services/firecrawlService.js';
import { ScraperService } from '../services/scraperService.js';
import { prisma } from '../config/prisma.js';

describe('ClientScraperService & Isolamento de Auditoria de Clientes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Blindagem Anti-SSRF em Ativos de Clientes (@security-engineer)', () => {
    it('deve bloquear URLs de loopback locais (127.0.0.1 e localhost)', async () => {
      await expect(
        ClientScraperService.scrapeClientAsset({ url: 'http://127.0.0.1:8080/portal-medico' })
      ).rejects.toThrow(/SSRF Bloqueado/);

      await expect(
        ClientScraperService.scrapeClientAsset({ url: 'http://localhost:3000/clinica' })
      ).rejects.toThrow(/SSRF Bloqueado/);
    });

    it('deve bloquear endereços de metadados de nuvem da AWS/GCP (169.254.169.254)', async () => {
      await expect(
        ClientScraperService.scrapeClientAsset({ url: 'http://169.254.169.254/latest/meta-data/' })
      ).rejects.toThrow(/SSRF Bloqueado/);
    });

    it('deve bloquear subredes privadas RFC 1918 (192.168.1.1 e 10.0.0.1)', async () => {
      await expect(
        ClientScraperService.scrapeClientAsset({ url: 'http://192.168.1.1/dashboard' })
      ).rejects.toThrow(/SSRF Bloqueado/);

      await expect(
        ClientScraperService.scrapeClientAsset({ url: 'http://10.0.0.1/admin' })
      ).rejects.toThrow(/SSRF Bloqueado/);
    });
  });

  describe('2. Extração e Persistência Isolada em ClientScrapedData & ModuleScrapeData', () => {
    it('deve extrair markdown de cliente e persistir exclusivamente em ClientScrapedData', async () => {
      vi.spyOn(ScraperService, 'scrape').mockResolvedValueOnce({
        cleanMarkdown: '# ClÃ­nica MÃ©dica Bem Estar\n\nAtendimento especializado em dermatologia e cardiologia.',
        rawLength: 100,
        tokensCount: 25,
        detectedTags: ['DERMATOLOGIA'],
      } as any);

      const createClientScrapedDataSpy = vi.spyOn(prisma.clientScrapedData, 'create').mockResolvedValueOnce({
        id: 'client-asset-123',
      } as any);

      // Espia prisma.norm.create para garantir ISOLAMENTO
      const normCreateSpy = vi.spyOn((prisma as any).norm, 'create');

      const result = await ClientScraperService.scrapeClientAsset({
        url: 'https://clinica-exemplo.med.br/sobre',
        clientId: 'client-id-999',
        tags: ['CARDIOLOGIA'],
      });

      expect(result.status).toBe('EXTRACTION_SUCCESS');
      // Higienização anti-mojibake verificada
      expect(result.markdown).toContain('Clínica Médica Bem Estar');
      expect(createClientScrapedDataSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientId: 'client-id-999',
            url: 'https://clinica-exemplo.med.br/sobre',
          }),
        })
      );

      // GARANTIA DE ISOLAMENTO: Coleção de normas públicas NUNCA deve ser chamada
      expect(normCreateSpy).not.toHaveBeenCalled();
    });

    it('deve persistir em ModuleScrapeData quando moduleId for fornecido', async () => {
      vi.spyOn(ScraperService, 'scrape').mockResolvedValueOnce({
        cleanMarkdown: '# Módulo de Atendimento\n\nTermo de Consentimento Livre e Esclarecido.',
        rawLength: 80,
        tokensCount: 20,
      } as any);

      const createModuleSpy = vi.spyOn(prisma.moduleScrapeData, 'create').mockResolvedValueOnce({
        id: 'module-scrape-456',
      } as any);

      const result = await ClientScraperService.scrapeClientAsset({
        url: 'https://clinica-exemplo.med.br/tcle',
        moduleId: 'module-id-111',
      });

      expect(result.status).toBe('EXTRACTION_PERSISTED');
      expect(createModuleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            moduleId: 'module-id-111',
            url: 'https://clinica-exemplo.med.br/tcle',
          }),
        })
      );
    });

    it('deve lançar erro e bloquear laudo caso todo o conteúdo retornado seja vazio', async () => {
      vi.spyOn(ScraperService, 'scrape').mockResolvedValueOnce({
        cleanMarkdown: '',
        rawLength: 0,
        tokensCount: 0,
      } as any);

      await expect(
        ClientScraperService.scrapeClientAsset({ url: 'https://clinica-vazia.med.br' })
      ).rejects.toThrow(/EXTRACTION_FAILED/);
    });
  });

  describe('3. Compatibilidade da Façade FirecrawlService', () => {
    it('FirecrawlService.scrape deve delegar transparentemente para ClientScraperService', async () => {
      const delegateSpy = vi.spyOn(ClientScraperService, 'scrapeClientAsset').mockResolvedValueOnce({
        status: 'EXTRACTION_SUCCESS',
        markdown: '# Façade OK',
        rawContent: '# Façade OK',
        contentHash: 'hash-abc',
        url: 'https://clinica-facade.med.br',
        source: 'FIRECRAWL_API',
        createdAt: new Date(),
        extractedAt: new Date().toISOString(),
        tokensCount: 10,
        tags: [],
      });

      const res = await FirecrawlService.scrape('https://clinica-facade.med.br', 'mod-1', 'cli-1');

      expect(delegateSpy).toHaveBeenCalledWith({
        url: 'https://clinica-facade.med.br',
        moduleId: 'mod-1',
        clientId: 'cli-1',
      });
      expect(res.markdown).toBe('# Façade OK');
    });
  });
});
