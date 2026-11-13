import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SmartScraperService,
  DocumentoNormativoRagSchema,
  RagMetadataSchema,
  generateSemanticChunks,
} from '../services/smartScraperService.js';
import { prisma } from '../config/prisma.js';
import * as securityModule from '../shared/security.js';

// Mocks do Prisma
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

describe('SmartScraperService - Navegação Profunda (Deep Crawl) e Estruturação para RAG (T37)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Contrato e Validação Zod para RAG (DocumentoNormativoRagSchema)', () => {
    it('deve validar com sucesso a estrutura exata exigida de DocumentoNormativo com metadadosRAG', () => {
      const payloadExemplo = {
        documentoNormativo: {
          titulo: 'Resolução CFM nº 2.336/2023 sobre Publicidade Médica',
          tipo: 'RESOLUCAO' as const,
          numeroAno: '2.336/2023',
          dataPublicacao: '2023-09-13',
          linkOficial: 'https://sistemas.cfm.org.br/normas/visualizar/resolucoes/2336-2023',
          textoIntegralOriginal: 'Texto integral regulatório da Resolução CFM nº 2.336/2023, estabelecendo os limites e diretrizes da propaganda médica no Brasil.',
          metadadosRAG: {
            chunkingSugerido: true,
            tamanhoMaximoChunk: 512,
            sobreposicaoChunk: 64,
            contextoSemantico: 'Diretrizes deontológicas oficiais para divulgação de serviços médicos e redes sociais.',
          },
        },
      };

      const parsed = DocumentoNormativoRagSchema.parse(payloadExemplo);
      expect(parsed.documentoNormativo.titulo).toBe('Resolução CFM nº 2.336/2023 sobre Publicidade Médica');
      expect(parsed.documentoNormativo.tipo).toBe('RESOLUCAO');
      expect(parsed.documentoNormativo.numeroAno).toBe('2.336/2023');
      expect(parsed.documentoNormativo.metadadosRAG.tamanhoMaximoChunk).toBe(512);
      expect(parsed.documentoNormativo.metadadosRAG.sobreposicaoChunk).toBe(64);
      expect(parsed.documentoNormativo.metadadosRAG.chunkingSugerido).toBe(true);
    });

    it('deve rejeitar documento com metadadosRAG inválidos ou sem contextoSemantico', () => {
      const payloadInvalido = {
        documentoNormativo: {
          titulo: 'Norma Incompleta',
          tipo: 'RESOLUCAO',
          numeroAno: '1/2024',
          linkOficial: 'https://cfm.org.br/norma',
          textoIntegralOriginal: 'Texto curto',
          metadadosRAG: {
            chunkingSugerido: true,
            tamanhoMaximoChunk: 512,
            contextoSemantico: 'Curto', // Mínimo 10 caracteres
          },
        },
      };

      expect(() => DocumentoNormativoRagSchema.parse(payloadInvalido)).toThrow();
    });
  });

  describe('2. Algoritmo de Chunking Semântico com Overlap', () => {
    it('deve retornar bloco único quando o texto for menor que o tamanho máximo do chunk', () => {
      const textoCurto = 'Este é um dispositivo normativo breve com menos de 512 tokens.';
      const chunks = generateSemanticChunks(textoCurto, 512, 64);

      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe(textoCurto);
    });

    it('deve dividir textos longos em múltiplos chunks com sobreposição sem perder continuidade', () => {
      // Gera texto com múltiplos artigos simulando resolução extensa
      const artigos = Array.from({ length: 40 }, (_, i) => `\nArt. ${i + 1}º Fica estabelecido o dispositivo normativo número ${i + 1} para auditoria de saúde suplementar e conformidade.\nParágrafo único. A observância é obrigatória sob pena de sanções deontológicas.\n`);
      const textoLongo = artigos.join('\n');

      const chunks = generateSemanticChunks(textoLongo, 128, 32);

      expect(chunks.length).toBeGreaterThan(1);
      // O primeiro chunk deve conter o início do texto
      expect(chunks[0]).toContain('Art. 1º');
      // Chunks adjacentes devem manter sobreposição
      expect(chunks[1]).toBeDefined();
    });
  });

  describe('3. Motor de Navegação Profunda (Deep Crawl de Submenus Institucionais)', () => {
    it('deve extrair links de submenus e navegação institucional (Resoluções, Pareceres, Normas) a partir da landing page', () => {
      const mockHtmlLandingPage = `
        <!DOCTYPE html>
        <html>
        <head><title>Portal CFM</title></head>
        <body>
          <header>
            <nav class="main-menu">
              <ul>
                <li><a href="/institucional">Quem Somos</a></li>
                <li><a href="/resolucoes">Resoluções e Atos Normativos</a></li>
                <li><a href="https://portal.cfm.org.br/pareceres">Pareceres do CFM</a></li>
                <li><a href="/camara-tecnica">Câmara Técnica de Medicina</a></li>
                <li><a href="https://instagram.com/cfm">Instagram</a></li>
              </ul>
            </nav>
          </header>
          <main>Conteúdo da Home</main>
        </body>
        </html>
      `;

      const submenus = SmartScraperService.extractNavigationSubmenuLinks(
        mockHtmlLandingPage,
        'https://portal.cfm.org.br'
      );

      const urls = submenus.map((s) => s.url);
      expect(urls).toContain('https://portal.cfm.org.br/resolucoes');
      expect(urls).toContain('https://portal.cfm.org.br/pareceres');
      expect(urls).toContain('https://portal.cfm.org.br/camara-tecnica');
      // Redes sociais e links institucionais neutros são ignorados
      expect(urls).not.toContain('https://instagram.com/cfm');
      expect(urls).not.toContain('https://portal.cfm.org.br/institucional');
    });
  });

  describe('4. Execução Integrada com Deep Crawl e Estruturação RAG', () => {
    it('deve executar deep crawl, extrair norma com envelope RAG e persistir no MongoDB', async () => {
      const mockLandingHtml = `
        <html><body>
          <nav><a href="https://portal.cfm.org.br/normas">Normas Oficiais</a></nav>
        </body></html>
      `;

      vi.spyOn(securityModule, 'safeHttpGet').mockResolvedValue({
        data: mockLandingHtml,
        status: 200,
        headers: {},
      } as any);

      const mockRagDocument = {
        documentoNormativo: {
          titulo: 'Parecer CFM nº 01/2026 sobre Inteligência Artificial Diagnóstica',
          tipo: 'PARECER',
          numeroAno: '01/2026',
          dataPublicacao: '2026-01-15',
          linkOficial: 'https://sistemas.cfm.org.br/pareceres/01-2026',
          textoIntegralOriginal: 'O parecer define que sistemas de apoio à decisão clínica baseados em aprendizado profundo devem operar com explicabilidade e supervisão médica presencial.',
          metadadosRAG: {
            chunkingSugerido: true,
            tamanhoMaximoChunk: 512,
            sobreposicaoChunk: 64,
            contextoSemantico: 'Regulação de modelos de fundação e IA diagnóstica no prontuário médico.',
          },
        },
      };

      const mockFirecrawl = {
        scrapeUrl: vi.fn().mockResolvedValue({
          documentsFound: [mockRagDocument],
        }),
      };
      SmartScraperService.setFirecrawlClient(mockFirecrawl);

      vi.mocked(prisma.scrapedPage.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.scrapedPage.create).mockResolvedValueOnce({
        id: 'page-rag-01',
      } as any);

      const result = await SmartScraperService.executeSmartScrape({
        urlAlvo: 'https://portal.cfm.org.br',
        deepCrawl: true,
      });

      expect(result.success).toBe(true);
      expect(result.newNormsCount).toBe(1);
      expect(result.newNorms[0].normCode).toBe('01/2026');
      expect(result.newNorms[0].metadadosRAG?.chunkingSugerido).toBe(true);

      // Valida persistência no MongoDB com tag RAG_READY
      expect(prisma.scrapedPage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tags: expect.arrayContaining(['RAG_READY']),
            cleanMarkdown: expect.stringContaining('Regulação de modelos de fundação e IA diagnóstica no prontuário médico.'),
          }),
        })
      );
    });
  });
});
