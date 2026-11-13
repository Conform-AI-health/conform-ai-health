import { describe, it, expect, vi, beforeEach } from 'vitest';
import Firecrawl from '@mendable/firecrawl-js';

/**
 * Testes de Contrato do SDK Real `@mendable/firecrawl-js@4.52.0` + Cenários BDD (Estágios 2.0 e 4)
 *
 * Requisitos atendidos:
 * - PONTO 1: NUNCA mocka `FirecrawlClient`. Instancia o SDK real `@mendable/firecrawl-js@4.52.0`
 *   e intercepta a camada HTTP (`sdk.http.instance` / adapter Axios) para validar o body real enviado
 *   para `/v2/scrape`, `/v2/map`, `/v2/search` e o shape real de retorno.
 * - PONTO 2 (ADR-001): No fluxo de normas, `FirecrawlClient` envia APENAS `['markdown', 'links', 'html', 'rawHtml']`
 *   (SEM formato `json`). O formato `json` fica restrito a `ClientWebsiteExtractionSchema`.
 * - AJUSTE 1: Verifica preservação de `<strike>`/`<s>`/`<del>` com `onlyMainContent`, fallback automático para `rawHtml`,
 *   exclusão de artigo revogado (tachado) dentro de norma `VIGENTE` em `norms_chunk`, e filtro obrigatório de `status`
 *   na busca vetorial (`searchNormChunksVector`).
 */

const mockNormDocs: any[] = [];
const mockNormChunks: any[] = [];
const mockScrapedPages: any[] = [];
const mockSystemLogs: any[] = [];

vi.mock('../config/prisma.js', () => ({
  prisma: {
    norm: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where?.urlOriginal) {
          return mockNormDocs.find((n) => n.urlOriginal === where.urlOriginal) || null;
        }
        if (where?.OR) {
          return (
            mockNormDocs.find(
              (n) =>
                where.OR.some((cond: any) => cond.normId && n.normId === cond.normId) ||
                where.OR.some((cond: any) => cond.urlOriginal && n.urlOriginal === cond.urlOriginal)
            ) || null
          );
        }
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const created = { id: `norm-${mockNormDocs.length + 1}`, ...data };
        mockNormDocs.push(created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = mockNormDocs.findIndex((n) => n.id === where.id);
        if (idx >= 0) {
          mockNormDocs[idx] = { ...mockNormDocs[idx], ...data };
          return mockNormDocs[idx];
        }
        return { id: where.id, ...data };
      }),
    },
    normChunk: {
      deleteMany: vi.fn(async ({ where }: any) => {
        for (let i = mockNormChunks.length - 1; i >= 0; i--) {
          if (mockNormChunks[i].normId === where.normId) {
            mockNormChunks.splice(i, 1);
          }
        }
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        for (const item of data) {
          mockNormChunks.push({ id: `chunk-${mockNormChunks.length + 1}`, ...item });
        }
        return { count: data.length };
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return mockNormChunks
          .map((ch) => ({
            ...ch,
            norm: mockNormDocs.find((n) => n.id === ch.normId) || null,
          }))
          .filter((ch) => {
            if (where?.norm?.status) {
              return ch.norm?.status === where.norm.status;
            }
            return true;
          });
      }),
    },
    scrapedPage: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existingIndex = mockScrapedPages.findIndex((page) => page.url === where.url);
        if (existingIndex >= 0) {
          mockScrapedPages[existingIndex] = { ...mockScrapedPages[existingIndex], ...update };
          return mockScrapedPages[existingIndex];
        }
        const created = { id: `page-${mockScrapedPages.length + 1}`, ...create };
        mockScrapedPages.push(created);
        return created;
      }),
    },
    systemLog: {
      create: vi.fn(async ({ data }: any) => {
        mockSystemLogs.push(data);
        return { id: `log-${mockSystemLogs.length}`, ...data };
      }),
    },
  },
}));

vi.mock('../shared/security.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    validateSafeUrlAsync: vi.fn(async (url: string) => {
      if (url.includes('127.0.0.1') || url.includes('169.254.169.254')) {
        return { safe: false, reason: 'IP privado/loopback bloqueado' };
      }
      return { safe: true };
    }),
  };
});

import { FirecrawlClient } from '../services/firecrawl/firecrawlClient.js';
import {
  ClientWebsiteExtractionSchema,
  buildClientWebsiteExtractionPrompt,
} from '../services/firecrawl/firecrawlSchemas.js';
import { LegalNormCrawlerService } from '../services/legalNormCrawlerService.js';
import { ScraperService } from '../services/scraperService.js';

describe('Firecrawl SDK v2 (@mendable/firecrawl-js@4.52.0) — Testes de Contrato HTTP & BDD (Estágios 2.0 e 4)', () => {
  let capturedHttpRequests: Array<{
    method: string;
    url: string;
    body: any;
    headers: any;
  }> = [];

  /**
   * Cria uma instância REAL do SDK `@mendable/firecrawl-js` (v4.52.0) e intercepta o adapter HTTP
   * do `axios` interno do SDK (`realSdk.http.instance.defaults.adapter`), sem mockar o `FirecrawlClient`.
   */
  function attachRealSdkWithHttpInterceptor(
    handler: (req: { method: string; url: string; body: any; headers: any }) => {
      status: number;
      data: any;
    }
  ) {
    const realSdk = new (Firecrawl as any)({
      apiKey: 'fc-secret-contract-test-key-999999',
      apiUrl: 'https://api.firecrawl.dev',
      maxRetries: 1,
    });

    realSdk.http.instance.defaults.adapter = async (config: any) => {
      const parsedBody =
        typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
      const reqInfo = {
        method: (config.method || 'post').toUpperCase(),
        url: config.url || '',
        body: parsedBody,
        headers: config.headers || {},
      };
      capturedHttpRequests.push(reqInfo);

      const mockRes = handler(reqInfo);
      if (mockRes.status >= 400) {
        const axiosErr: any = new Error(`Request failed with status code ${mockRes.status}`);
        axiosErr.isAxiosError = true;
        axiosErr.response = {
          status: mockRes.status,
          data: mockRes.data,
          headers: {},
          config,
        };
        throw axiosErr;
      }

      return {
        status: mockRes.status,
        statusText: 'OK',
        headers: {},
        config,
        data: mockRes.data,
      };
    };

    FirecrawlClient.setSdk(realSdk);
    return realSdk;
  }

  beforeEach(() => {
    capturedHttpRequests = [];
    mockNormDocs.length = 0;
    mockNormChunks.length = 0;
    mockScrapedPages.length = 0;
    mockSystemLogs.length = 0;
    FirecrawlClient.circuitBreaker.reset();
    FirecrawlClient.resetSdk();
    vi.clearAllMocks();
  });

  it('Cenário 1 (Contrato SDK v2 — P1, P2, P3 e PONTO 2): scrapeJson de cliente usa /v2/scrape com { type: "json", prompt, schema } convertido para JSON Schema e lê doc.json direto; scrapeMarkdownAndLinks de normas NÃO envia formato json nem limit', async () => {
    attachRealSdkWithHttpInterceptor((req) => {
      if (req.url.endsWith('/v2/scrape') && req.body.url.includes('clinica-exemplo')) {
        return {
          status: 200,
          data: {
            success: true,
            data: {
              markdown: '# Clínica Exemplo\nAtendimento com CRM/SP 123456 e RQE 7890.',
              links: ['https://clinica-exemplo.com.br/privacidade'],
              json: {
                crmsDetectados: ['CRM/SP 123456'],
                rqesDetectados: ['RQE 7890'],
                termosSensacionalistas: [],
                antesEDepoisDetectado: false,
                coletaDadosLGPDDetectada: true,
                politicaPrivacidadePresente: true,
                resumoExecutivo: 'Website institucional com política de privacidade e CRM válido.',
              },
            },
          },
        };
      }

      // Resposta de /v2/scrape para fluxo de normas (Planalto)
      return {
        status: 200,
        data: {
          success: true,
          data: {
            markdown: '# LEI Nº 13.709, DE 14 DE AGOSTO DE 2018\nArt. 1º Esta Lei dispõe sobre a proteção de dados.',
            html: '<html><body><h1>LEI Nº 13.709</h1><p>Art. 1º Esta Lei dispõe sobre a proteção de dados.</p></body></html>',
            rawHtml: '<html><body><h1>LEI Nº 13.709</h1><p>Art. 1º Esta Lei dispõe sobre a proteção de dados.</p></body></html>',
            links: ['https://www.planalto.gov.br/ccivil_03/decreto.htm'],
          },
        },
      };
    });

    // 1A. Testa scrapeJson (exclusivo de auditoria de site de cliente — PONTO 2)
    const clientRes = await FirecrawlClient.scrapeJson(
      'https://clinica-exemplo.com.br',
      ClientWebsiteExtractionSchema,
      buildClientWebsiteExtractionPrompt(['CFM', 'LGPD'])
    );

    expect(capturedHttpRequests.length).toBe(1);
    const clientHttpCall = capturedHttpRequests[0];
    expect(clientHttpCall.url).toContain('/v2/scrape');
    // P1: Não envia 'extract' top-level
    expect(clientHttpCall.body.extract).toBeUndefined();
    // P3: Não envia 'limit' em scrape de página única
    expect(clientHttpCall.body.limit).toBeUndefined();
    // P1: Envia formato { type: 'json', prompt, schema } onde o SDK real converteu o Zod Schema para JSON Schema!
    const jsonFmt = clientHttpCall.body.formats.find((f: any) => typeof f === 'object' && f.type === 'json');
    expect(jsonFmt).toBeDefined();
    expect(jsonFmt.prompt).toContain('FILTRO DE AUDITORIA TEMÁTICA OPCIONAL ATIVO');
    expect(jsonFmt.schema.type).toBe('object');
    expect(jsonFmt.schema.properties).toHaveProperty('crmsDetectados');

    // P2: Lê doc.json diretamente validado pelo Zod
    expect(clientRes.data?.crmsDetectados).toEqual(['CRM/SP 123456']);
    expect(clientRes.data?.politicaPrivacidadePresente).toBe(true);

    // 1B. Testa scrapeMarkdownAndLinks (fluxo de normas — PONTO 2: SEM formato `json`)
    const normCapture = await FirecrawlClient.scrapeMarkdownAndLinks(
      'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm'
    );

    expect(capturedHttpRequests.length).toBe(2);
    const normHttpCall = capturedHttpRequests[1];
    expect(normHttpCall.url).toContain('/v2/scrape');
    expect(normHttpCall.body.extract).toBeUndefined();
    expect(normHttpCall.body.limit).toBeUndefined();
    // PONTO 2: Confirma que NENHUM formato 'json' é enviado no fluxo de normas
    const hasJsonFormatInNorm = normHttpCall.body.formats.some(
      (f: any) => f === 'json' || (typeof f === 'object' && f.type === 'json')
    );
    expect(hasJsonFormatInNorm).toBe(false);
    expect(normHttpCall.body.formats).toEqual(expect.arrayContaining(['markdown', 'links', 'html', 'rawHtml']));
    expect(normCapture.markdown).toContain('LEI Nº 13.709');
  });

  it('Cenário 2 (Descoberta Determinística de Links e Contrato /v2/map + /v2/search — P2 e P4): descobre links sem LLM e searchWeb lê .web sem acionar o getter .data que lança erro na v2', async () => {
    attachRealSdkWithHttpInterceptor((req) => {
      if (req.url.endsWith('/v2/map')) {
        return {
          status: 200,
          data: {
            success: true,
            links: [
              { url: 'https://portal.cfm.org.br/normas/resolucao-2336-2023.pdf', title: 'Resolução CFM 2336/2023' },
              { url: 'https://portal.cfm.org.br/normas/parecer-10-2024.htm', title: 'Parecer CFM 10/2024' },
              { url: 'https://portal.cfm.org.br/inicio', title: 'Página Inicial' },
              { url: 'https://portal.cfm.org.br/privacidade', title: 'Política de Privacidade' },
            ],
          },
        };
      }
      if (req.url.endsWith('/v2/search')) {
        return {
          status: 200,
          data: {
            success: true,
            data: {
              web: [
                {
                  url: 'https://sistemas.cfm.org.br/normas/resolucao-2336-2023',
                  title: 'RESOLUÇÃO CFM Nº 2.336/2023',
                  markdown: 'RESOLUÇÃO CFM Nº 2.336/2023. Dispõe sobre publicidade médica. Art. 1º É permitido ao médico divulgar seu trabalho.',
                },
              ],
            },
          },
        };
      }
      return { status: 200, data: { success: true, data: {} } };
    });

    const mappedUrls = await FirecrawlClient.mapUrl('https://portal.cfm.org.br/normas', { limit: 10 });
    expect(mappedUrls).toEqual([
      'https://portal.cfm.org.br/normas/resolucao-2336-2023.pdf',
      'https://portal.cfm.org.br/normas/parecer-10-2024.htm',
    ]);

    // P2: O SDK real define um getter em `out.data` que lança Error("SearchData has no '.data'...").
    // `FirecrawlClient.searchWeb` deve ler `out.web` sem disparar o getter!
    const searchResults = await FirecrawlClient.searchWeb('resolução CFM 2336');
    expect(searchResults.length).toBe(1);
    expect(searchResults[0].url).toBe('https://sistemas.cfm.org.br/normas/resolucao-2336-2023');

    // P4: Extração determinística de links de página de listagem HTML sem usar LLM
    const listingHtml = `
      <html><body>
        <table>
          <tr>
            <td>Resolução CFM nº 2.314/2022 - Telemedicina</td>
            <td><a href="/normas/resolucao-2314-2022.pdf">Baixar PDF</a></td>
          </tr>
        </table>
      </body></html>
    `;
    const deterministicLinks = ScraperService.extractTagAndPdfLinksFromHtml(
      listingHtml,
      '',
      mappedUrls,
      'https://portal.cfm.org.br/normas',
      ['CFM']
    );
    expect(deterministicLinks.map((l) => l.url)).toContain(
      'https://portal.cfm.org.br/normas/resolucao-2314-2022.pdf'
    );
    expect(deterministicLinks.map((l) => l.url)).toContain(
      'https://portal.cfm.org.br/normas/resolucao-2336-2023.pdf'
    );
  });

  it('Cenário 3 & AJUSTE 1 (Preservação de <strike>/<s>/<del> e Artigo Revogado dentro de Norma VIGENTE + Norma Expressamente Revogada + Filtro em Busca Vetorial): usa rawHtml se html perder <strike>, não gera chunk para artigo tachado e nunca retorna norma revogada na busca vetorial', async () => {
    // 3A. Simula o Firecrawl v2 onde `html` (limpo com onlyMainContent) removeu `<strike>`, mas `rawHtml` preservou
    attachRealSdkWithHttpInterceptor(() => ({
      status: 200,
      data: {
        success: true,
        data: {
          markdown: '# LEI Nº 12.965, DE 23 DE ABRIL DE 2014',
          // `html` limpo sem a tag <strike>
          html: `<html><body>
            <h1>LEI Nº 12.965, DE 23 DE ABRIL DE 2014</h1>
            <p>Estabelece princípios, garantias, direitos e deveres para o uso da Internet no Brasil.</p>
            <p>Art. 1º Esta Lei estabelece princípios, garantias, direitos e deveres para o uso da Internet no Brasil.</p>
            <p>Art. 2º A disciplina do uso da internet no Brasil tem como fundamento o respeito à liberdade de expressão.</p>
            <p>Art. 3º Esta Lei entra em vigor após decorridos 60 dias de sua publicação oficial.</p>
          </body></html>`,
          // `rawHtml` original do Planalto contendo Art. 2º inteiramente tachado (<strike>)
          rawHtml: `<html><body>
            <h1>LEI Nº 12.965, DE 23 DE ABRIL DE 2014</h1>
            <p>Estabelece princípios, garantias, direitos e deveres para o uso da Internet no Brasil.</p>
            <p>Art. 1º Esta Lei estabelece princípios, garantias, direitos e deveres para o uso da Internet no Brasil.</p>
            <p><strike>Art. 2º Texto antigo revogado pela Lei posterior sobre disciplina da internet.</strike></p>
            <p>Art. 3º Esta Lei entra em vigor após decorridos 60 dias de sua publicação oficial.</p>
          </body></html>`,
          links: [],
        },
      },
    }));

    const fcPlanalto = await FirecrawlClient.scrapeMarkdownAndLinks(
      'https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm',
      { onlyMainContent: true }
    );

    // AJUSTE 1: Detectou que `html` perdeu `<strike>` presente em `rawHtml` e fez fallback automático para `rawHtml`
    expect(fcPlanalto.preservedStrikeTags).toBe(false);
    expect(fcPlanalto.html).toContain('<strike>');

    const extractedActiveNorm = LegalNormCrawlerService.extractCleanMarkdownFromHtml(
      'https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm',
      fcPlanalto.html
    );

    // O texto integral bruto (`contentMd`) marca o trecho tachado com ~~...~~
    expect(extractedActiveNorm.contentMd).toContain('~~Art. 2º Texto antigo revogado');
    // O texto ativo (`activeContentMd`) NÃO contém o Art. 2º revogado!
    expect(extractedActiveNorm.activeContentMd).not.toContain('Texto antigo revogado');

    const classificationActive = await LegalNormCrawlerService.classifyLegalNorm(extractedActiveNorm);
    expect(classificationActive.isNorm).toBe(true);
    expect(classificationActive.status).toBe('active');

    const persistedActive = await LegalNormCrawlerService.persistNormWithIdempotency({
      doc: extractedActiveNorm,
      classification: classificationActive,
      discoveredFrom: extractedActiveNorm.url,
      originChain: [extractedActiveNorm.url],
    });

    // Apenas Art. 1º e Art. 3º geram chunks em `norms_chunk`; o Art. 2º (tachado/revogado) NÃO gera chunk!
    expect(persistedActive.chunksCount).toBe(2);
    const activeArticlesInChunks = mockNormChunks.map((c) => {
      const meta = JSON.parse(c.contextoSemantico);
      return meta.article;
    });
    expect(activeArticlesInChunks).toEqual(['Art. 1º', 'Art. 3º']);
    expect(activeArticlesInChunks).not.toContain('Art. 2º');
    const scrapedPage = mockScrapedPages.find((page) => page.url === extractedActiveNorm.url);
    expect(scrapedPage.cleanMarkdown).toContain('Texto antigo revogado');

    // 3B. Norma inteiramente REVOGADA (aviso expresso no cabeçalho) -> salva em `norms` com status REVOGADA e 0 chunks em `norms_chunk`
    const revokedHtml = `
      <html><body>
        <h1>RESOLUÇÃO CFM Nº 1.974/2011 (Revogada pela Resolução CFM nº 2.336/2023)</h1>
        <p>Estabelece os critérios norteadores da propaganda em Medicina.</p>
        <p>Art. 1º Entender-se-á por anúncio a comunicação ao público.</p>
        <p>Art. 2º É vedado ao médico expor a figura de seu paciente.</p>
        <p>Art. 3º Esta resolução entra em vigor na data de sua publicação.</p>
      </body></html>
    `;
    const extractedRevoked = LegalNormCrawlerService.extractCleanMarkdownFromHtml(
      'https://sistemas.cfm.org.br/normas/resolucao-1974-2011',
      revokedHtml
    );
    const classificationRevoked = await LegalNormCrawlerService.classifyLegalNorm(extractedRevoked);
    expect(classificationRevoked.isNorm).toBe(true);
    expect(classificationRevoked.status).toBe('revoked');

    const persistedRevoked = await LegalNormCrawlerService.persistNormWithIdempotency({
      doc: extractedRevoked,
      classification: classificationRevoked,
      discoveredFrom: extractedRevoked.url,
      originChain: [extractedRevoked.url],
    });

    expect(persistedRevoked.norm.status).toBe('REVOGADA');
    expect(persistedRevoked.chunksCount).toBe(0);

    // 3C. Busca vetorial (`searchNormChunksVector`) SEMPRE filtra status = VIGENTE por padrão
    const vectorResults = await LegalNormCrawlerService.searchNormChunksVector({
      query: 'princípios uso da Internet no Brasil',
    });
    expect(vectorResults.length).toBeGreaterThan(0);
    expect(vectorResults.every((r) => r.status === 'active')).toBe(true);
    expect(vectorResults.some((r) => r.text.includes('Texto antigo revogado'))).toBe(false);
  });

  it('Cenário 4 (Cláusula "Revogam-se as disposições em contrário"): mantém a norma como VIGENTE e gera chunks normalmente', async () => {
    const vigenteComClausulaRevogacaoHtml = `
      <html><body>
        <h1>PORTARIA Nº 500, DE 10 DE JANEIRO DE 2025</h1>
        <p>Dispõe sobre diretrizes de prontuário eletrônico e segurança da informação.</p>
        <p>Art. 1º Ficam instituídas as diretrizes de prontuário eletrônico.</p>
        <p>Art. 2º Os sistemas devem utilizar assinatura digital ICP-Brasil.</p>
        <p>Art. 3º Fica revogada a Portaria nº 120/2018 e revogam-se as disposições em contrário.</p>
      </body></html>
    `;

    const extracted = LegalNormCrawlerService.extractCleanMarkdownFromHtml(
      'https://www.in.gov.br/web/dou/-/portaria-500-2025',
      vigenteComClausulaRevogacaoHtml
    );
    const classification = await LegalNormCrawlerService.classifyLegalNorm(extracted);

    expect(ScraperService.isExplicitlyRevokedNorm(extracted.title, extracted.activeContentMd)).toBe(false);
    expect(classification.isNorm).toBe(true);
    expect(classification.status).toBe('active');

    const persisted = await LegalNormCrawlerService.persistNormWithIdempotency({
      doc: extracted,
      classification,
      discoveredFrom: extracted.url,
      originChain: [extracted.url],
    });

    expect(persisted.norm.status).toBe('VIGENTE');
    expect(persisted.chunksCount).toBe(3);
  });

  it('Cenário 5 (Página que não é norma: Notícia / Índice sem artigos): descarta o documento e não grava em norms nem em norms_chunk', async () => {
    const newsHtml = `
      <html><body>
        <title>Notícia: Workshop sobre Inovação em Saúde Digital reúne especialistas em Brasília</title>
        <h1>Notícia: Workshop sobre Inovação em Saúde Digital</h1>
        <p>Assessoria de Comunicação (ASCOM) informa que o evento ocorreu na última terça-feira.</p>
        <a href="https://www.gov.br/saude/evento-1">Programação</a>
        <a href="https://www.gov.br/saude/evento-2">Palestrantes</a>
      </body></html>
    `;

    const extracted = LegalNormCrawlerService.extractCleanMarkdownFromHtml(
      'https://www.gov.br/saude/pt-br/noticias/workshop-inovacao',
      newsHtml
    );
    const classification = await LegalNormCrawlerService.classifyLegalNorm(extracted);

    expect(classification.isNorm).toBe(false);
    expect(classification.reason).toContain('notícia');
    expect(mockNormDocs.length).toBe(0);
    expect(mockNormChunks.length).toBe(0);
  });

  it('Cenário 6 (Resiliência P8 & Segurança DevSecOps): falhas HTTP 500 na API do Firecrawl abrem o CircuitBreaker e mascaram a FIRECRAWL_API_KEY nos logs', async () => {
    attachRealSdkWithHttpInterceptor(() => ({
      status: 500,
      data: {
        success: false,
        error: 'Internal Server Error while authenticating Bearer fc-secret-contract-test-key-999999',
      },
    }));

    // 3 falhas consecutivas para atingir o failureThreshold (3) do CircuitBreaker
    for (let i = 0; i < 3; i++) {
      await expect(
        FirecrawlClient.scrapeMarkdownAndLinks('https://www.planalto.gov.br/ccivil_03/lei-teste.htm')
      ).rejects.toThrow();
    }

    expect(FirecrawlClient.circuitBreaker.getState()).toBe('OPEN');

    // A 4ª chamada deve falhar imediatamente no CircuitBreaker (fail-fast) sem fazer nova requisição HTTP
    const callsBeforeOpen = capturedHttpRequests.length;
    await expect(
      FirecrawlClient.scrapeMarkdownAndLinks('https://www.planalto.gov.br/ccivil_03/lei-teste.htm')
    ).rejects.toThrow(/CircuitBreaker.*OPEN/i);
    expect(capturedHttpRequests.length).toBe(callsBeforeOpen);

    // Verifica que a chave secreta foi mascarada ([REDACTED]) nos logs de telemetria
    expect(mockSystemLogs.length).toBe(4);
    for (const logEntry of mockSystemLogs) {
      expect(logEntry.message).not.toContain('fc-secret-contract-test-key-999999');
      expect(logEntry.details).not.toContain('fc-secret-contract-test-key-999999');
    }
    expect(mockSystemLogs.slice(0, 3).every((l) => l.message.includes('[REDACTED]'))).toBe(true);
    expect(mockSystemLogs[3].message).toContain('ABERTO (OPEN)');
  });
});
