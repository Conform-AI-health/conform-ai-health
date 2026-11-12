import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RegulatoryScraperService,
  generateDeterministicEmbedding,
} from '../services/regulatoryScraperService.js';
import { EmailService } from '../services/emailService.js';
import { prisma } from '../config/prisma.js';

describe('RegulatoryScraperService & Persistência Vetorial RAG em norms e norms_chunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Blindagem Anti-SSRF e Deep Crawl de Portais Regulatórios', () => {
    it('deve bloquear URLs de loopback e IPs privados', async () => {
      await expect(
        RegulatoryScraperService.executeRegulatoryScrape({ urlAlvo: 'http://127.0.0.1:8000/normas' })
      ).rejects.toThrow(/SSRF Bloqueado/);

      await expect(
        RegulatoryScraperService.executeRegulatoryScrape({ urlAlvo: 'http://192.168.0.100/resolucoes' })
      ).rejects.toThrow(/SSRF Bloqueado/);
    });

    it('deve identificar links de menus e submenus regulatórios no HTML institucional', () => {
      const sampleHtml = `
        <header>
          <nav>
            <a href="/resolucoes">Resoluções do CFM</a>
            <a href="/pareceres">Pareceres Oficiais</a>
            <a href="/contato">Fale Conosco</a>
            <a href="https://portal.cfm.org.br/normas/legislacao">Legislação e Atos</a>
          </nav>
        </header>
      `;

      const submenus = RegulatoryScraperService.extractSubmenuLinks(sampleHtml, 'https://portal.cfm.org.br');

      expect(submenus.length).toBeGreaterThanOrEqual(3);
      expect(submenus.some((s) => s.url === 'https://portal.cfm.org.br/resolucoes')).toBe(true);
      expect(submenus.some((s) => s.url === 'https://portal.cfm.org.br/pareceres')).toBe(true);
      expect(submenus.some((s) => s.url === 'https://portal.cfm.org.br/normas/legislacao')).toBe(true);
      // Link genérico não deve ser incluído
      expect(submenus.some((s) => s.url.includes('/contato'))).toBe(false);
    });
  });

  describe('2. Geração de Embeddings Vetoriais para RAG', () => {
    it('deve gerar vetor numérico de 768 dimensões com norma L2 unitária para similaridade de cosseno', () => {
      const text = 'Art. 1º É vedado ao médico prescrever tratamento sem anamnese prévia.';
      const vector = generateDeterministicEmbedding(text, 768);

      expect(vector.length).toBe(768);

      // Valida L2 Norm ~ 1.0
      const normSquare = vector.reduce((acc, val) => acc + val * val, 0);
      expect(Math.sqrt(normSquare)).toBeCloseTo(1.0, 2);
    });
  });

  describe('3. Persistência Estruturada nas Coleções norms e norms_chunk', () => {
    it('deve persistir documento mestre em norms (com ambas as versões: bruta e higienizada) e fragmentos vetoriais em norms_chunk', async () => {
      const mockRawContentWithMojibake = `---
id: CFM-RES-999-2026
tipo: Resolucao
numero: '999'
ano: '2026'
ementa: DispÃµe sobre padrÃµes de seguranÃ§a em prontuÃ¡rio eletrÃ´nico
---

# RESOLUÃ‡ÃƒO CFM NÂº 999/2026

Art. 1Âº O prontuÃ¡rio eletrÃ´nico deverÃ¡ garantir criptografia ponta a ponta.
Art. 2Âº As infraÃ§Ãµes serÃ£o apuradas pelos Conselhos Regionais de Medicina.`;

      const mockFirecrawlClient = {
        scrape: vi.fn().mockResolvedValue({
          data: {
            extract: {
              documents: [
                {
                  numeroAno: '999/2026',
                  orgao: 'CFM',
                  tipo: 'RESOLUCAO',
                  titulo: 'RESOLUÃ‡ÃƒO CFM NÂº 999/2026',
                  ementa: 'DispÃµe sobre padrÃµes de seguranÃ§a em prontuÃ¡rio eletrÃ´nico',
                  dataPublicacao: '2026-05-10',
                  officialUrl: 'https://portal.cfm.org.br/resolucoes/999-2026',
                  urlPdfOriginal: 'https://portal.cfm.org.br/arquivos/999-2026.pdf',
                  textoIntegralOriginal: mockRawContentWithMojibake,
                },
              ],
            },
          },
        }),
      };

      RegulatoryScraperService.setFirecrawlClient(mockFirecrawlClient);

      // Mock Prisma: findFirst retorna null (norma inédita)
      vi.spyOn((prisma as any).norm, 'findFirst').mockResolvedValue(null);

      // Mock criação do mestre em norms
      const normCreateSpy = vi.spyOn((prisma as any).norm, 'create').mockResolvedValueOnce({
        id: 'norm-db-id-777',
        normId: '999/2026',
      });

      // Mock criação dos chunks em norms_chunk
      const normChunkCreateManySpy = vi.spyOn((prisma as any).normChunk, 'createMany').mockResolvedValueOnce({
        count: 1,
      });

      // Espia client_scraped_data para GARANTIA DE ISOLAMENTO
      const clientDataSpy = vi.spyOn(prisma.clientScrapedData, 'create');

      const result = await RegulatoryScraperService.executeRegulatoryScrape({
        urlAlvo: 'https://portal.cfm.org.br/novidades',
        notifyOnNewNorms: false,
      });

      expect(result.success).toBe(true);
      expect(result.newNormsCount).toBe(1);

      // 1. Validação em 'norms': salvamento de AMBAS as versões
      expect(normCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            normId: '999/2026',
            orgao: 'CFM',
            tipo: 'RESOLUCAO',
            // Versão 1: Conteúdo original bruto preservado
            conteudoOriginalBruto: mockRawContentWithMojibake,
            // Versão 2: Conteúdo higienizado (anti-mojibake)
            conteudoHigienizado: expect.stringContaining('RESOLUÇÃO CFM Nº 999/2026'),
            ementaHigienizada: expect.stringContaining('Dispõe sobre padrões de segurança'),
          }),
        })
      );

      // 2. Validação em 'norms_chunk': salvamento de chunks com embedding
      expect(normChunkCreateManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              normId: 'norm-db-id-777',
              normCode: '999/2026',
              chunkIndex: 1,
              embedding: expect.any(Array),
            }),
          ]),
        })
      );

      // 3. Validação de Isolamento Estrito: nunca grava em client_scraped_data
      expect(clientDataSpy).not.toHaveBeenCalled();
    });

    it('deve disparar e-mail de alerta regulatório quando novas normas forem detectadas', async () => {
      const mockFirecrawlClient = {
        scrape: vi.fn().mockResolvedValue({
          data: {
            extract: {
              documents: [
                {
                  numeroAno: '1000/2026',
                  orgao: 'CFM',
                  tipo: 'RESOLUCAO',
                  titulo: 'Resolução Telemedicina com IA',
                  officialUrl: 'https://portal.cfm.org.br/resolucoes/1000-2026',
                  textoIntegralOriginal: 'Texto integral da nova resolução.',
                },
              ],
            },
          },
        }),
      };

      RegulatoryScraperService.setFirecrawlClient(mockFirecrawlClient);
      vi.spyOn((prisma as any).norm, 'findFirst').mockResolvedValue(null);
      vi.spyOn((prisma as any).norm, 'create').mockResolvedValue({ id: 'norm-1000' });
      vi.spyOn((prisma as any).normChunk, 'createMany').mockResolvedValue({ count: 1 });

      const emailSpy = vi.spyOn(EmailService, 'sendEmail').mockResolvedValueOnce({
        id: 'email-alert-123',
        status: 'SENT',
      } as any);

      const result = await RegulatoryScraperService.executeRegulatoryScrape({
        urlAlvo: 'https://portal.cfm.org.br/ultimas-normas',
        notifyOnNewNorms: true,
        notificationEmail: 'auditor.saude@conformia.med.br',
      });

      expect(result.newNormsCount).toBe(1);
      expect(emailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'auditor.saude@conformia.med.br',
          subject: expect.stringContaining('Novas Normas Regulatórias Detectadas'),
        })
      );
    });
  });
});
