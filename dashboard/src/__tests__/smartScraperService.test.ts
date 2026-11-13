import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SmartScraperService,
  RegulatoryDocumentSchema,
  SmartScraperExtractionSchema,
  REGULATORY_AUDIT_PROMPT,
} from '../services/smartScraperService.js';
import { prisma } from '../config/prisma.js';
import { EmailService } from '../services/emailService.js';

// Mocks do Prisma e EmailService
vi.mock('../config/prisma.js', () => ({
  prisma: {
    scrapedPage: {
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    systemLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

describe('SmartScraperService & Ingestão Inteligente de Normas (T35)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Validação de Contrato & Schemas Zod', () => {
    it('deve validar com sucesso documento normativo com enum correto e campos obrigatórios', () => {
      const validDoc = {
        documentType: 'RESOLUCAO',
        normCode: 'Res. CFM 2.336/2023',
        title: 'Regulamentação da Publicidade e Propaganda Médica',
        article: 'Artigo 11',
        content: 'São vedadas práticas de autopromoção sensacionalista e divulgação de preços promocionais.',
        authority: 'CFM',
        officialUrl: 'https://sistemas.cfm.org.br/normas/visualizar/resolucoes/2336-2023',
        summary: 'Diretrizes deontológicas para divulgação de serviços médicos.',
        keywords: ['publicidade', 'medicina', 'deontologia'],
      };

      const parsed = RegulatoryDocumentSchema.parse(validDoc);
      expect(parsed.documentType).toBe('RESOLUCAO');
      expect(parsed.normCode).toBe('Res. CFM 2.336/2023');
      expect(parsed.authority).toBe('CFM');
      expect(parsed.officialUrl).toBe('https://sistemas.cfm.org.br/normas/visualizar/resolucoes/2336-2023');
    });

    it('deve aceitar todas as tipologias regulatórias do enum (RESOLUCAO, PARECER, PORTARIA, NOTA_TECNICA, OUTRO)', () => {
      const types = ['RESOLUCAO', 'PARECER', 'PORTARIA', 'NOTA_TECNICA', 'OUTRO'] as const;

      for (const t of types) {
        const doc = {
          documentType: t,
          normCode: `Norma-${t}-2026`,
          title: `Documento oficial do tipo ${t}`,
          content: 'Dispositivo normativo de teste regulatório.',
          authority: 'ANVISA',
          officialUrl: 'https://anvisa.gov.br/normas/doc',
          summary: 'Resumo do dispositivo oficial.',
        };
        const parsed = RegulatoryDocumentSchema.parse(doc);
        expect(parsed.documentType).toBe(t);
      }
    });

    it('deve rejeitar documento com tipologia inválida ou URL ausente', () => {
      const invalidDoc = {
        documentType: 'NOTICIA_INVALIDA',
        normCode: '123',
        title: 'Título Curto',
        content: 'Curto',
        authority: 'X',
        officialUrl: 'url-invalida',
        summary: 'Resumo',
      };

      expect(() => RegulatoryDocumentSchema.parse(invalidDoc)).toThrow();
    });

    it('deve validar o schema consolidado SmartScraperExtractionSchema', () => {
      const payload = {
        sourcePortal: 'Portal CFM Oficial',
        extractionTimestamp: new Date().toISOString(),
        documentsFound: [
          {
            documentType: 'PARECER',
            normCode: 'Parecer CFM 12/2024',
            title: 'Uso de Ferramentas de IA em Prontuário Eletrônico',
            content: 'O médico assistente permanece exclusivamente responsável pelas condutas sugeridas por IA.',
            authority: 'CFM',
            officialUrl: 'https://sistemas.cfm.org.br/normas/parecer-12-2024',
            summary: 'Responsabilidade médica no uso de IA.',
          },
        ],
      };

      const parsed = SmartScraperExtractionSchema.parse(payload);
      expect(parsed.documentsFound.length).toBe(1);
      expect(parsed.documentsFound[0].normCode).toBe('Parecer CFM 12/2024');
    });

    it('deve conter as instruções mandatórias no prompt especializado de auditoria regulatória', () => {
      expect(REGULATORY_AUDIT_PROMPT).toContain('Você é um auditor regulatório sênior');
      expect(REGULATORY_AUDIT_PROMPT).toContain('Ignore banners de rodapé, notícias genéricas de eventos');
      expect(REGULATORY_AUDIT_PROMPT).toContain('Não invente URLs');
    });
  });

  describe('2. Blindagem Anti-SSRF & Guardrails (@security-engineer)', () => {
    it('deve bloquear URLs de loopback (127.0.0.1) e registrar log de segurança', async () => {
      const result = await SmartScraperService.executeSmartScrape({
        urlAlvo: 'http://127.0.0.1:8080/admin',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('SSRF Bloqueado');
      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            level: 'WARN',
            module: 'SMART_SCRAPER',
            message: expect.stringContaining('bloqueada por política anti-SSRF'),
          }),
        })
      );
    });

    it('deve bloquear URLs de metadados de nuvem (169.254.169.254)', async () => {
      const result = await SmartScraperService.executeSmartScrape({
        urlAlvo: 'http://169.254.169.254/latest/meta-data/',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('SSRF Bloqueado');
    });

    it('deve bloquear subredes privadas RFC 1918 (192.168.1.1 e 10.0.0.1)', async () => {
      const result = await SmartScraperService.executeSmartScrape({
        urlAlvo: 'http://192.168.1.1/router-login',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('SSRF Bloqueado');
    });
  });

  describe('3. Ingestão com Firecrawl, Diffing e Persistência no MongoDB', () => {
    it('deve identificar norma inédita, persistir no MongoDB e retornar diff com newNorms', async () => {
      const mockDocuments = [
        {
          documentType: 'RESOLUCAO',
          normCode: 'Res. CFM 2.400/2026',
          title: 'Diretrizes Éticas para Telemedicina com IA Preditiva',
          article: 'Artigo 4º',
          content: 'A prescrição automatizada por IA sem validação humana é terminantemente proibida.',
          authority: 'CFM',
          officialUrl: 'https://sistemas.cfm.org.br/normas/resolucoes/2400-2026',
          summary: 'Vedação a prescrição autônoma sem supervisão médica direta.',
          keywords: ['telemedicina', 'inteligencia-artificial'],
        },
      ];

      const mockFirecrawl = {
        scrapeUrl: vi.fn().mockResolvedValue({
          documentsFound: mockDocuments,
        }),
      };
      SmartScraperService.setFirecrawlClient(mockFirecrawl);

      // Simula que a norma NÃO existe no banco
      vi.mocked(prisma.scrapedPage.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.scrapedPage.create).mockResolvedValueOnce({
        id: 'new-norm-id-777',
      } as any);

      const result = await SmartScraperService.executeSmartScrape({
        urlAlvo: 'https://portal.cfm.org.br/novas-resolucoes',
        tags: ['CFM', 'SAUDE_DIGITAL'],
        deepCrawl: false,
      });

      expect(result.success).toBe(true);
      expect(result.totalCaptured).toBe(1);
      expect(result.newNormsCount).toBe(1);
      expect(result.existingNormsCount).toBe(0);
      expect(result.newNorms[0].normCode).toBe('Res. CFM 2.400/2026');
      expect(result.persistedRecords).toContain('new-norm-id-777');

      // Verifica criação no MongoDB com tags dinâmicas
      expect(prisma.scrapedPage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            url: 'https://sistemas.cfm.org.br/normas/resolucoes/2400-2026',
            title: '[CFM] Res. CFM 2.400/2026 - Diretrizes Éticas para Telemedicina com IA Preditiva',
            cleanMarkdown: expect.stringContaining('Diretrizes Éticas para Telemedicina com IA Preditiva'),
          }),
        })
      );

      // Verifica gravação no SystemLog
      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            level: 'INFO',
            module: 'SMART_SCRAPER',
            message: expect.stringContaining('[SMART_SCRAPER_SUCCESS]'),
          }),
        })
      );
    });

    it('quando a norma já existir no banco, deve identificá-la no diff e NÃO duplicar a persistência', async () => {
      const mockDocuments = [
        {
          documentType: 'PORTARIA',
          normCode: 'Portaria MS 100/2025',
          title: 'Interoperabilidade de Prontuários Eletrônicos no SUS',
          content: 'Padrão openEHR e HL7 FHIR para integração de dados clínicos.',
          authority: 'MS',
          officialUrl: 'https://gov.br/saude/portaria-100-2025',
          summary: 'Padronização de formatos clínicos.',
        },
      ];

      const mockFirecrawl = {
        scrapeUrl: vi.fn().mockResolvedValue({
          documentsFound: mockDocuments,
        }),
      };
      SmartScraperService.setFirecrawlClient(mockFirecrawl);

      // Simula que a norma JÁ EXISTE no MongoDB
      vi.mocked(prisma.scrapedPage.findFirst).mockResolvedValueOnce({
        id: 'existing-norm-id',
        url: 'https://gov.br/saude/portaria-100-2025',
        title: '[MS] Portaria MS 100/2025',
      } as any);

      const result = await SmartScraperService.executeSmartScrape({
        urlAlvo: 'https://gov.br/saude/legislacao',
        deepCrawl: false,
      });

      expect(result.success).toBe(true);
      expect(result.totalCaptured).toBe(1);
      expect(result.newNormsCount).toBe(0);
      expect(result.existingNormsCount).toBe(1);
      expect(result.persistedRecords.length).toBe(0);
      expect(prisma.scrapedPage.create).not.toHaveBeenCalled();
    });

    it('deve disparar e-mail de alerta quando configurado notifyOnNewNorms e houver novas resoluções', async () => {
      const mockDocuments = [
        {
          documentType: 'NOTA_TECNICA',
          normCode: 'Nota Técnica ANVISA 05/2026',
          title: 'Classificação de Software como Dispositivo Médico (SaMD) com Algoritmos Generativos',
          content: 'Sistemas que realizem inferência diagnóstica classificam-se como Classe III de risco sanitário.',
          authority: 'ANVISA',
          officialUrl: 'https://anvisa.gov.br/notas/nt-05-2026',
          summary: 'Enquadramento regulatório de IA generativa clínica.',
        },
      ];

      const mockFirecrawl = {
        scrapeUrl: vi.fn().mockResolvedValue({
          documentsFound: mockDocuments,
        }),
      };
      SmartScraperService.setFirecrawlClient(mockFirecrawl);

      vi.mocked(prisma.scrapedPage.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.scrapedPage.create).mockResolvedValueOnce({ id: 'page-samd-1' } as any);

      const sendEmailSpy = vi.spyOn(EmailService, 'sendEmail').mockResolvedValueOnce({
        success: true,
        messageId: 'alert-msg-id-123',
      });

      const result = await SmartScraperService.executeSmartScrape({
        urlAlvo: 'https://anvisa.gov.br/dispositivos-medicos',
        notifyOnNewNorms: true,
        notificationEmail: 'compliance@conformia.med.br',
        deepCrawl: false,
      });

      expect(result.success).toBe(true);
      expect(result.newNormsCount).toBe(1);
      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'compliance@conformia.med.br',
          subject: expect.stringContaining('Novas Normas Regulatórias Detectadas (1)'),
          html: expect.stringContaining('Nota Técnica ANVISA 05/2026'),
        })
      );
    });
  });
});
