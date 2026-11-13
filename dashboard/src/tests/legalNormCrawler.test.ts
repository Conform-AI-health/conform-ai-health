import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LegalNormCrawlerService } from '../services/legalNormCrawlerService.js';
import { SemanticEmbeddingService } from '../services/semanticEmbeddingService.js';

// Mock em memória do Prisma para validar persistência idempotente, versionamento, commit por arquivo e telemetria
const { normsStore, chunksStore, scrapedPagesStore, telemetryLogs } = vi.hoisted(() => ({
  normsStore: new Map<string, any>(),
  chunksStore: new Map<string, any[]>(),
  scrapedPagesStore: new Map<string, any>(),
  telemetryLogs: [] as any[],
}));

vi.mock('../config/prisma.js', () => ({
  prisma: {
    norm: {
      findFirst: vi.fn(async ({ where }) => {
        for (const norm of normsStore.values()) {
          if (where?.urlOriginal && norm.urlOriginal === where.urlOriginal) {
            return norm;
          }
          if (where?.normId && norm.normId === where.normId) {
            return norm;
          }
        }
        return null;
      }),
      create: vi.fn(async ({ data }) => {
        const id = `norm-${normsStore.size + 1}`;
        const record = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
        normsStore.set(id, record);
        return record;
      }),
      update: vi.fn(async ({ where, data }) => {
        const existing = normsStore.get(where.id);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        normsStore.set(where.id, updated);
        return updated;
      }),
    },
    normChunk: {
      deleteMany: vi.fn(async ({ where }) => {
        if (where?.normId) {
          chunksStore.set(where.normId, []);
        }
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }) => {
        if (Array.isArray(data) && data.length > 0) {
          const normId = data[0].normId;
          const existing = chunksStore.get(normId) || [];
          const withIds = data.map((item, i) => ({ id: `chunk-${normId}-${i + 1}`, ...item }));
          chunksStore.set(normId, [...existing, ...withIds]);
        }
        return { count: data.length };
      }),
      findMany: vi.fn(async () => {
        const all: any[] = [];
        for (const [normId, list] of chunksStore.entries()) {
          const norm = normsStore.get(normId);
          for (const ch of list) {
            all.push({ ...ch, norm });
          }
        }
        return all;
      }),
    },
    scrapedPage: {
      upsert: vi.fn(async ({ where, create, update }) => {
        const existing = scrapedPagesStore.get(where.url);
        const record = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : { id: `page-${scrapedPagesStore.size + 1}`, ...create, createdAt: new Date() };
        scrapedPagesStore.set(where.url, record);
        return record;
      }),
    },
    systemLog: {
      create: vi.fn(async ({ data }) => {
        telemetryLogs.push(data);
        return data;
      }),
    },
  },
}));

describe('LegalNormCrawlerService — 6 Cenários Obrigatórios (Node.js/TypeScript → MongoDB RAG)', () => {
  beforeEach(() => {
    normsStore.clear();
    chunksStore.clear();
    scrapedPagesStore.clear();
    telemetryLogs.length = 0;
    vi.clearAllMocks();
    vi.spyOn(SemanticEmbeddingService, 'embedDocuments').mockImplementation(
      async (texts) => texts.map(() => [1, 0])
    );
    vi.spyOn(SemanticEmbeddingService, 'embedQuery').mockResolvedValue([1, 0]);
  });

  it('1. Página-índice em tabela (UFCG LGPD Documentos): descobre links para Planalto, DOU, ANPD e PDFs locais com contexto e descarta o índice HTML', async () => {
    const indexUrl = 'https://www.gov.br/ufcg/pt-br/acesso-a-informacao/lei-geral-de-protecao-de-dados/documentos';
    const ufcgTableHtml = `
      <html>
        <head><title>Documentos LGPD — UFCG</title></head>
        <body>
          <header><nav><a href="https://facebook.com/ufcg">Facebook</a></nav></header>
          <main id="content">
            <h1>Documentos e Legislação LGPD</h1>
            <table>
              <thead>
                <tr><th>Documento</th><th>Órgão</th><th>Descrição</th><th>Link</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Lei nº 13.709/2018</td>
                  <td>Planalto</td>
                  <td>Lei Geral de Proteção de Dados Pessoais</td>
                  <td><a href="http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm">Texto Compilado</a></td>
                </tr>
                <tr>
                  <td>Resolução CD/ANPD nº 2/2022</td>
                  <td>DOU / Imprensa Nacional</td>
                  <td>Regulamento de aplicação da LGPD para agentes de pequeno porte</td>
                  <td><a href="https://www.in.gov.br/en/web/dou/-/resolucao-cd-anpd-n-2-de-27-de-janeiro-de-2022">Publicação DOU</a></td>
                </tr>
                <tr>
                  <td>Guia Orientativo ANPD</td>
                  <td>ANPD</td>
                  <td>Definições dos Agentes de Tratamento</td>
                  <td><a href="https://www.gov.br/anpd/pt-br/documentos-e-publicacoes/guia_agentes_de_tratamento.pdf">Baixar PDF</a></td>
                </tr>
                <tr>
                  <td>Portaria Interna UFCG</td>
                  <td>UFCG</td>
                  <td>Institui Comitê de Governança de Dados</td>
                  <td><a href="/ufcg/pt-br/acesso-a-informacao/portaria-lgpd-ufcg/@@display-file/file">Download</a></td>
                </tr>
              </tbody>
            </table>
          </main>
        </body>
      </html>
    `;

    const extractedIndex = LegalNormCrawlerService.extractCleanMarkdownFromHtml(indexUrl, ufcgTableHtml, 0, [indexUrl]);
    const discoveredUrls = extractedIndex.discoveredLinks.map((l) => l.url);

    // Deve descobrir os 4 links oficiais (Planalto, DOU, ANPD PDF e PDF local @@display-file) e ignorar Facebook
    expect(discoveredUrls).toContain('http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm');
    expect(discoveredUrls).toContain('https://www.in.gov.br/en/web/dou/-/resolucao-cd-anpd-n-2-de-27-de-janeiro-de-2022');
    expect(discoveredUrls).toContain('https://www.gov.br/anpd/pt-br/documentos-e-publicacoes/guia_agentes_de_tratamento.pdf');
    expect(discoveredUrls).toContain('https://www.gov.br/ufcg/pt-br/acesso-a-informacao/portaria-lgpd-ufcg/@@display-file/file');

    // Verifica preservação do contexto da linha da tabela (surroundingText) e classificação de tipo
    const planaltoLink = extractedIndex.discoveredLinks.find((l) => l.url.includes('planalto.gov.br'))!;
    expect(planaltoLink.surroundingText).toContain('Lei Geral de Proteção de Dados Pessoais');

    const localDisplayFile = extractedIndex.discoveredLinks.find((l) => l.url.includes('@@display-file'))!;
    expect(localDisplayFile.fileType).toBe('pdf');

    // A própria página-índice em tabela NÃO deve ser classificada como norma
    const indexClassification = await LegalNormCrawlerService.classifyLegalNorm(extractedIndex, ['LGPD']);
    expect(indexClassification.isNorm).toBe(false);
  });

  it('descarta links de menu pelo rótulo normalizado, mantendo links de conteúdo', () => {
    const url = 'https://www.gov.br/ufcg/documentos';
    const html = `
      <html><body>
        <div class="content-menu-links">
          <a href="/inicio">• 1. Ínicio</a>
          <a href="/cookies">Política de cookies</a>
          <a href="/atalho">Ir para o conteúdo principal</a>
          <a href="/credits">© Copyright 2026</a>
          <a href="/ufcg">Conheça a UFCG</a>
          <a href="/sei">Sistema Eletrônico de Informações (SEI!)</a>
          <a href="/campus">Campus Campina Grande</a>
        </div>
        <main>
          <a href="/norma">Resolução CFM nº 2.336/2023</a>
        </main>
      </body></html>
    `;
    const skipped: { url: string; reason: string }[] = [];

    const links = LegalNormCrawlerService.discoverLinksFromHtml(html, url, 0, [url], [], skipped);

    expect(links.map((link) => link.url)).toEqual(['https://www.gov.br/norma']);
    expect(skipped).toHaveLength(7);
    expect(skipped.every((link) => link.reason === 'Rótulo de menu, navegação ou rodapé')).toBe(true);
  });

  it('ignora links estruturais em navbar, breadcrumbs e footer independentemente do texto âncora', () => {
    const url = 'https://www.gov.br/saude/normas/2024';
    const html = `
      <html><body>
        <nav class="navbar"><a href="/menu-destino">Resolução CFM nº 999/2024</a></nav>
        <div class="breadcrumb"><a href="/breadcrumb-destino">Lei nº 888/2024</a></div>
        <footer><a href="/footer-destino">Portaria nº 777/2024</a></footer>
        <main><a href="/normas/2024/resolucao-123">Resolução CFM nº 123/2024</a></main>
      </body></html>
    `;
    const skipped: { url: string; reason: string }[] = [];

    const links = LegalNormCrawlerService.discoverLinksFromHtml(html, url, 0, [url], [], skipped);

    expect(links.map((link) => link.url)).toEqual([
      'https://www.gov.br/normas/2024/resolucao-123',
    ]);
    expect(skipped.map((link) => link.url)).toEqual([
      'https://www.gov.br/menu-destino',
      'https://www.gov.br/breadcrumb-destino',
      'https://www.gov.br/footer-destino',
    ]);
    expect(skipped.every((link) => link.reason.includes('navbar, breadcrumb ou footer'))).toBe(true);
  });

  it('ignora formatos de mídia, arquivos de interface e caminhos de frameworks/plugins', () => {
    const url = 'https://www.gov.br/saude/normas';
    const html = `
      <html><body><main>
        <a href="/media/logo.svg">Logo</a>
        <a href="/media/photo.avif">Imagem AVIF</a>
        <a href="/media/photo.tiff">Imagem TIFF</a>
        <a href="/media/icon.icns">Ícone</a>
        <a href="/media/audio.opus">Áudio</a>
        <a href="/media/audio.m4a">Áudio M4A</a>
        <a href="/assets/site.css">CSS</a>
        <a href="/assets/application.mjs">JavaScript</a>
        <a href="/wp-content/plugins/example/readme">Plugin</a>
        <a href="/framework/docs">Framework</a>
        <a href="/normas/resolucao-123.pdf">Resolução em PDF</a>
        <a href="/normas/resolucao-456.md">Resolução em Markdown</a>
      </main></body></html>
    `;
    const skipped: { url: string; reason: string }[] = [];

    const links = LegalNormCrawlerService.discoverLinksFromHtml(html, url, 0, [url], [], skipped);

    expect(links.map((link) => link.url)).toEqual([
      'https://www.gov.br/normas/resolucao-123.pdf',
      'https://www.gov.br/normas/resolucao-456.md',
    ]);
    expect(skipped).toHaveLength(10);
    expect(skipped.every((link) => link.reason.includes('Asset estático'))).toBe(true);

    const pdfLinks = LegalNormCrawlerService.extractLinksFromPdfBufferAndText(
      null,
      'Imagem https://www.gov.br/media/image.avif, áudio https://www.gov.br/media/sound.flac e norma https://www.gov.br/leis/lei-123.pdf',
      'https://www.gov.br/leis/documento.pdf'
    );
    expect(pdfLinks.map((link) => link.url)).toEqual(['https://www.gov.br/leis/lei-123.pdf']);
  });

  it('não segue links para home ou breadcrumbs ancestrais, mas mantém links descendentes da página atual', () => {
    const url = 'https://www.gov.br/saude/pt-br/normas/cfm';
    const html = `
      <html><body>
        <div class="page-crumbs">
          <a href="/">Catálogo geral</a>
          <a href="/saude/pt-br/normas">Normas de saúde</a>
        </div>
        <main>
          <a href="/saude/pt-br/normas/cfm/2024">Resoluções CFM de 2024</a>
        </main>
      </body></html>
    `;
    const skipped: { url: string; reason: string }[] = [];

    const links = LegalNormCrawlerService.discoverLinksFromHtml(html, url, 0, [url], [], skipped);

    expect(links.map((link) => link.url)).toEqual([
      'https://www.gov.br/saude/pt-br/normas/cfm/2024',
    ]);
    expect(skipped.map((link) => link.url)).toEqual([
      'https://www.gov.br/',
      'https://www.gov.br/saude/pt-br/normas',
    ]);
    expect(skipped.every((link) => link.reason.includes('ancestral'))).toBe(true);
  });

  it('classifica e extrai o texto completo de arquivos Markdown para a pipeline de normas', async () => {
    const url = 'https://www.gov.br/saude/arquivos/resolucao-cfm-2336-2023.md';
    const markdown = [
      '# Resolução CFM nº 2.336/2023',
      '',
      'Dispõe sobre publicidade e propaganda médicas.',
      '',
      'Art. 1º Esta resolução estabelece regras para a publicidade médica.',
      '',
      'Art. 2º O médico deve observar as disposições desta resolução.',
    ].join('\n');

    expect(LegalNormCrawlerService.classifyLinkFileType(url)).toBe('markdown');
    expect(LegalNormCrawlerService.classifyLinkFileType('/download', 'Lei nº 13.709/2018.md')).toBe(
      'markdown'
    );
    expect(LegalNormCrawlerService.classifyLinkFileType('/documento', '', 'text/markdown')).toBe(
      'markdown'
    );

    const extracted = LegalNormCrawlerService.extractFromMarkdownText(url, markdown);
    expect(extracted.fileType).toBe('markdown');
    expect(extracted.extractionMethod).toBe('text');
    expect(extracted.title).toBe('Resolução CFM nº 2.336/2023');
    expect(extracted.contentMd).toBe(markdown);
    expect(extracted.activeContentMd).toBe(markdown);

    const classification = await LegalNormCrawlerService.classifyLegalNorm(extracted);
    expect(classification.isNorm).toBe(true);
    expect(classification.normType).toBe('resolucao');
  });

  it('2. HTML da Lei 13.709 (Planalto): extrai artigos, separa texto tachado (<strike>/<s>/<del>) do texto vigente e gera chunks por artigo com path hierárquico', async () => {
    const planaltoUrl = 'http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm';
    const planaltoHtml = `
      <html>
        <head><title>L13709 - Lei Geral de Proteção de Dados</title></head>
        <body>
          <p align="center">LEI Nº 13.709, DE 14 DE AGOSTO DE 2018</p>
          <p>Dispõe sobre a proteção de dados pessoais e altera a Lei nº 12.965, de 23 de abril de 2014.</p>
          <p>O PRESIDENTE DA REPÚBLICA Faço saber que o Congresso Nacional decreta e eu sanciono a seguinte Lei:</p>
          <p>CAPÍTULO I - DISPOSIÇÕES PRELIMINARES</p>
          <p>Art. 1º Esta Lei dispõe sobre o tratamento de dados pessoais, inclusive nos meios digitais, por pessoa natural ou por pessoa jurídica.</p>
          <p>Parágrafo único. As normas gerais contidas nesta Lei são de interesse nacional.</p>
          <p>CAPÍTULO II - DO TRATAMENTO DE DADOS PESSOAIS</p>
          <p>SEÇÃO I - DOS REQUISITOS PARA O TRATAMENTO DE DADOS PESSOAIS</p>
          <p><strike>Art. 7º O tratamento de dados pessoais somente poderá ser realizado mediante consentimento escrito.</strike></p>
          <p>Art. 7º O tratamento de dados pessoais somente poderá ser realizado nas seguintes hipóteses:</p>
          <p>I - mediante o fornecimento de consentimento pelo titular;</p>
          <p>§ 1º <del>Nos casos em que o consentimento for exigido, será considerado nulo se genérico.</del> (Revogado pela Lei nº 13.853, de 2019)</p>
          <p>§ 4º É dispensada a exigência do consentimento previsto no caput deste artigo para os dados tornados manifestamente públicos pelo titular.</p>
          <p>Art. 65. Esta Lei entra em vigor após decorridos 24 (vinte e quatro) meses de sua publicação oficial.</p>
        </body>
      </html>
    `;

    const extracted = LegalNormCrawlerService.extractCleanMarkdownFromHtml(planaltoUrl, planaltoHtml);

    // 1. Deve ter capturado os textos tachados em revokedStrikes
    expect(extracted.revokedStrikes.length).toBe(2);
    expect(extracted.contentMd).toContain('~~Art. 7º O tratamento de dados pessoais somente poderá ser realizado mediante consentimento escrito.~~');

    // 2. O activeContentMd NÃO deve conter os trechos tachados revogados misturados ao texto vigente
    expect(extracted.activeContentMd).not.toContain('mediante consentimento escrito');
    expect(extracted.activeContentMd).not.toContain('será considerado nulo se genérico');
    expect(extracted.activeContentMd).toContain('mediante o fornecimento de consentimento pelo titular');

    // 3. Classificação deve aprovar como norma legal (lei, 13709, 2018)
    const classification = await LegalNormCrawlerService.classifyLegalNorm(extracted, ['LGPD']);
    expect(classification.isNorm).toBe(true);
    expect(classification.normType).toBe('lei');
    expect(classification.number).toBe('13709');
    expect(classification.year).toBe(2018);

    // 4. Chunking por artigo preservando path hierárquico
    const chunks = LegalNormCrawlerService.chunkLegalNormByArticle(extracted.title, extracted.activeContentMd);
    expect(chunks.length).toBe(3); // Art. 1º, Art. 7º e Art. 65

    const art7Chunk = chunks.find((c) => c.article === 'Art. 7º')!;
    expect(art7Chunk).toBeDefined();
    expect(art7Chunk.path).toEqual([
      'CAPÍTULO II - DO TRATAMENTO DE DADOS PESSOAIS',
      'SEÇÃO I - DOS REQUISITOS PARA O TRATAMENTO DE DADOS PESSOAIS',
      'Art. 7º',
    ]);
    expect(art7Chunk.headingContext).toContain('CAPÍTULO II');
    expect(art7Chunk.headingContext).toContain('Art. 7º');
  });

  it('3. PDF com camada de texto e PDF escaneado (OCR): remove cabeçalhos/rodapés repetidos e marca extractionMethod corretamente', async () => {
    // Caso A: PDF escaneado sem camada de texto extraível -> extractionMethod = "ocr"
    const emptyScannedPdfBuffer = Buffer.from('%PDF-1.4\n%ScannedImageOnly\n%%EOF', 'utf8');
    const ocrExtracted = await LegalNormCrawlerService.extractFromPdfBuffer(
      'https://www.gov.br/anpd/digitalizado.pdf',
      emptyScannedPdfBuffer
    );
    expect(ocrExtracted.extractionMethod).toBe('ocr');

    // Caso B: DOCX/PDF com texto normativo estruturado -> extractionMethod = "text"
    const docxXml = `
      <w:document>
        <w:body>
          <w:p><w:r><w:t>PORTARIA Nº 450, DE 10 DE MAIO DE 2024</w:t></w:r></w:p>
          <w:p><w:r><w:t>Dispõe sobre a segurança da informação e proteção de dados pessoais em saúde.</w:t></w:r></w:p>
          <w:p><w:r><w:t>Art. 1º Fica instituída a política de governança de privacidade e LGPD.</w:t></w:r></w:p>
          <w:p><w:r><w:t>Art. 2º Esta Portaria entra em vigor na data de sua publicação.</w:t></w:r></w:p>
        </w:body>
      </w:document>
    `;
    const textDoc = LegalNormCrawlerService.extractFromDocxBuffer(
      'https://www.gov.br/saude/portaria-450.docx',
      Buffer.from(docxXml, 'utf8')
    );
    expect(textDoc.extractionMethod).toBe('text');
    const classification = await LegalNormCrawlerService.classifyLegalNorm(textDoc, ['LGPD']);
    expect(classification.isNorm).toBe(true);
    expect(classification.normType).toBe('portaria');
  });

  it('4. Página que NÃO é norma (notícia/institucional): descartada com motivo auditável', async () => {
    const newsHtml = `
      <html>
        <head><title>Notícia: ANPD realiza workshop sobre proteção de dados em Brasília</title></head>
        <body>
          <article>
            <h1>Notícia: ANPD realiza workshop sobre proteção de dados em Brasília</h1>
            <p>Assessoria de Comunicação informa que o evento contará com palestras educativas na próxima semana.</p>
          </article>
        </body>
      </html>
    `;
    const extracted = LegalNormCrawlerService.extractCleanMarkdownFromHtml(
      'https://www.gov.br/anpd/pt-br/assuntos/noticias/workshop-brasilia',
      newsHtml
    );

    const classification = await LegalNormCrawlerService.classifyLegalNorm(extracted, ['LGPD']);
    expect(classification.isNorm).toBe(false);
    expect(classification.reason).toContain('notícia');
  });

  it('5. Reprocessamento idempotente e busca vetorial: mesmo hash não duplica; hash novo incrementa version e substitui chunks sem órfãos', async () => {
    const url = 'http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm';
    const htmlV1 = `
      <html>
        <head><title>Lei nº 13.709/2018 - LGPD</title></head>
        <body>
          <p>LEI Nº 13.709, DE 14 DE AGOSTO DE 2018</p>
          <p>Dispõe sobre a proteção de dados pessoais.</p>
          <p>CAPÍTULO I - DISPOSIÇÕES PRELIMINARES</p>
          <p>Art. 1º Esta Lei dispõe sobre o tratamento de dados pessoais e privacidade.</p>
          <p>Art. 2º A disciplina da proteção de dados pessoais tem como fundamento o respeito à privacidade.</p>
        </body>
      </html>
    `;

    const docV1 = LegalNormCrawlerService.extractCleanMarkdownFromHtml(url, htmlV1);
    const classV1 = await LegalNormCrawlerService.classifyLegalNorm(docV1, ['LGPD']);

    // 1ª Execução: cria norma (version 1) e 2 chunks
    const firstRun = await LegalNormCrawlerService.persistNormWithIdempotency({
      doc: docV1,
      classification: classV1,
      discoveredFrom: url,
      originChain: [url],
      tags: ['LGPD'],
    });
    expect(firstRun.action).toBe('created');
    expect(firstRun.chunksCount).toBe(2);
    expect(normsStore.size).toBe(1);
    expect(scrapedPagesStore.size).toBe(1);
    expect(scrapedPagesStore.get(url).tags).toContain('LGPD');
    expect(scrapedPagesStore.get(url).tags).not.toContain('RAG_READY');
    expect(firstRun.norm.tags).toContain('RAG_READY');

    // 2ª Execução (mesmo hash): idempotente, ignora sem duplicar
    const secondRun = await LegalNormCrawlerService.persistNormWithIdempotency({
      doc: docV1,
      classification: classV1,
      discoveredFrom: url,
      originChain: [url],
      tags: ['LGPD', 'CFM'],
    });
    expect(secondRun.action).toBe('skipped_idempotent');
    expect(normsStore.size).toBe(1);
    expect(secondRun.norm.tags).toContain('CFM');
    expect(secondRun.norm.tags).toContain('RAG_READY');
    expect(scrapedPagesStore.size).toBe(1);
    expect(scrapedPagesStore.get(url).tags).toContain('CFM');

    // 3ª Execução (novo hash com Art. 3º adicionado): incrementa version para 2 e substitui chunks sem órfãos
    const htmlV2 = htmlV1.replace(
      '</body>',
      '<p>Art. 3º Esta Lei aplica-se a qualquer operação de tratamento realizada por pessoa natural ou jurídica.</p></body>'
    );
    const docV2 = LegalNormCrawlerService.extractCleanMarkdownFromHtml(url, htmlV2);
    const classV2 = await LegalNormCrawlerService.classifyLegalNorm(docV2, ['LGPD']);

    const thirdRun = await LegalNormCrawlerService.persistNormWithIdempotency({
      doc: docV2,
      classification: classV2,
      discoveredFrom: url,
      originChain: [url],
      tags: ['LGPD'],
    });
    expect(thirdRun.action).toBe('updated_version');
    expect(thirdRun.chunksCount).toBe(3);
    expect(scrapedPagesStore.size).toBe(1);
    expect(scrapedPagesStore.get(url).cleanMarkdown).toContain('Art. 3º');
    const savedMeta = JSON.parse(thirdRun.norm.metadadosRAG);
    expect(savedMeta.version).toBe(2);
    expect(chunksStore.get(thirdRun.norm.id)?.length).toBe(3); // Nenhum chunk órfão da v1!

    // Verifica POST /norms/search (busca vetorial nos chunks retornando path, source_url, norm_title)
    const searchResults = await LegalNormCrawlerService.searchNormChunksVector({
      query: 'tratamento de dados pessoais privacidade',
      filters: { norm_type: 'lei', year: 2018 },
      topK: 5,
    });
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].source_url).toBe(url);
    expect(searchResults[0].path).toContain('CAPÍTULO I - DISPOSIÇÕES PRELIMINARES');
  });

  it('6. Link dentro de PDF: extrai anotações /URI e URLs no texto do PDF respeitando depth e allowlist', () => {
    const fakePdfWithAnnotation = Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Annot /Subtype /Link /A << /S /URI /URI (http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) >> >> endobj\n',
      'latin1'
    );
    const pdfText = 'Consulte também a Resolução ANPD em https://www.in.gov.br/web/dou/-/resolucao-anpd-1, página anterior https://www.gov.br/ufcg e site externo não oficial https://www.exemplo-comercial.com.br/promo.';

    const pdfLinks = LegalNormCrawlerService.extractLinksFromPdfBufferAndText(
      fakePdfWithAnnotation,
      pdfText,
      'https://www.gov.br/ufcg/guia-lgpd.pdf',
      1, // depth atual = 1 -> links filhos terão depth = 2
      ['https://www.gov.br/ufcg/documentos', 'https://www.gov.br/ufcg/guia-lgpd.pdf']
    );

    const urls = pdfLinks.map((l) => l.url);
    expect(urls).toContain('http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm');
    expect(urls).toContain('https://www.in.gov.br/web/dou/-/resolucao-anpd-1');
    expect(urls).not.toContain('https://www.gov.br/ufcg');
    // Domínio comercial fora da allowlist não deve ser seguido
    expect(urls).not.toContain('https://www.exemplo-comercial.com.br/promo');
    expect(pdfLinks.every((l) => l.depth === 2)).toBe(true);
  });

  it('7. Commit por arquivo e log de erros na telemetria: registra commit individual e loga falhas sem interromper o lote', async () => {
    const urlOk = 'http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm';
    const htmlOk = `
      <html>
        <head><title>Lei nº 13.709/2018 - LGPD</title></head>
        <body>
          <p>LEI Nº 13.709, DE 14 DE AGOSTO DE 2018</p>
          <p>Art. 1º Esta Lei dispõe sobre o tratamento de dados pessoais.</p>
        </body>
      </html>
    `;

    const docOk = LegalNormCrawlerService.extractCleanMarkdownFromHtml(urlOk, htmlOk);
    const classOk = await LegalNormCrawlerService.classifyLegalNorm(docOk, ['LGPD']);

    await LegalNormCrawlerService.persistNormWithIdempotency({
      doc: docOk,
      classification: classOk,
      discoveredFrom: urlOk,
      originChain: [urlOk],
      tags: ['LGPD'],
    });

    // Verifica que o commit individual do arquivo foi registrado na telemetria (SystemLog)
    expect(
      telemetryLogs.some(
        (l) => l.level === 'INFO' && l.message.includes('[FILE_COMMIT_SUCCESS]')
      )
    ).toBe(true);

    // Simula falha de banco ao commitar um segundo arquivo e verifica que o erro é logado na telemetria
    const { prisma } = await import('../config/prisma.js');
    vi.mocked(prisma.norm.create).mockRejectedValueOnce(new Error('Falha simulada de conexão no commit do arquivo'));

    const urlFail = 'https://www.in.gov.br/web/dou/-/resolucao-cd-anpd-n-19-de-2024';
    const docFail = LegalNormCrawlerService.extractCleanMarkdownFromHtml(urlFail, htmlOk);

    await expect(
      LegalNormCrawlerService.persistNormWithIdempotency({
        doc: docFail,
        classification: classOk,
        discoveredFrom: urlFail,
        originChain: [urlFail],
        tags: ['LGPD'],
      })
    ).rejects.toThrow('Falha simulada de conexão no commit do arquivo');

    const errorLog = telemetryLogs.find(
      (l) => l.level === 'ERROR' && l.message.includes('[FILE_COMMIT_ERROR]')
    );
    expect(errorLog).toBeDefined();
    expect(errorLog.module).toBe('LEGAL_NORM_CRAWLER');
    expect(errorLog.details).toContain('resolucao-cd-anpd-n-19-de-2024');
  });
});
