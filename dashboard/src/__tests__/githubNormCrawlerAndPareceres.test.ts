import { describe, it, expect } from 'vitest';
import { LegalNormCrawlerService } from '../services/legalNormCrawlerService.js';

describe('T50: Ingestão de Repositórios GitHub Markdown & Suporte a Pareceres do CFM', () => {
  describe('1. Normalização de URLs do GitHub e Allowlist de Domínios', () => {
    it('deve identificar URLs do ecossistema GitHub', () => {
      expect(LegalNormCrawlerService.isGithubUrl('https://github.com/md-augustolinhares/cfm-normas')).toBe(true);
      expect(LegalNormCrawlerService.isGithubUrl('https://raw.githubusercontent.com/md-augustolinhares/cfm-normas/main/README.md')).toBe(true);
      expect(LegalNormCrawlerService.isGithubUrl('https://api.github.com/repos/md-augustolinhares/cfm-normas')).toBe(true);
      expect(LegalNormCrawlerService.isGithubUrl('https://planalto.gov.br/ccivil_03/leis')).toBe(false);
    });

    it('deve converter URLs web /blob/ para a URL de download direto raw.githubusercontent.com', () => {
      const blobUrl = 'https://github.com/md-augustolinhares/cfm-normas/blob/main/normas/pareceres/1985/CFM-PAR-1-1985.md';
      const expectedRaw = 'https://raw.githubusercontent.com/md-augustolinhares/cfm-normas/main/normas/pareceres/1985/CFM-PAR-1-1985.md';
      expect(LegalNormCrawlerService.convertGithubBlobToRawUrl(blobUrl)).toBe(expectedRaw);
    });

    it('deve manter URLs que não são /blob/ do GitHub inalteradas', () => {
      const normalUrl = 'https://sistemas.cfm.org.br/normas/visualizar/pareceres/BR/1985/1';
      expect(LegalNormCrawlerService.convertGithubBlobToRawUrl(normalUrl)).toBe(normalUrl);
    });

    it('deve permitir cross-domain automático entre github.com e raw.githubusercontent.com', () => {
      const rootUrl = 'https://github.com/md-augustolinhares/cfm-normas/tree/main/normas/pareceres/1985';
      const rawUrl = 'https://raw.githubusercontent.com/md-augustolinhares/cfm-normas/main/normas/pareceres/1985/CFM-PAR-1-1985.md';
      expect(LegalNormCrawlerService.isDomainAllowed(rawUrl, rootUrl)).toBe(true);
    });
  });

  describe('2. Descoberta Inteligente de Links em Páginas do GitHub', () => {
    it('deve extrair links para arquivos markdown convertidos para raw e descartar ruídos de navegação da interface', () => {
      const mockGithubHtml = `
        <html>
          <body>
            <nav class="navbar"><a href="/features">Features</a></nav>
            <div class="repository-content">
              <a href="/md-augustolinhares/cfm-normas/commits/main">Commits</a>
              <a href="/md-augustolinhares/cfm-normas/pulls">Pull Requests</a>
              <a href="/md-augustolinhares/cfm-normas/issues">Issues</a>
              <a href="/md-augustolinhares/cfm-normas/blob/main/normas/pareceres/1985/CFM-PAR-1-1985.md">CFM-PAR-1-1985.md</a>
              <a href="/md-augustolinhares/cfm-normas/blob/main/normas/pareceres/1985/CFM-PAR-5-1985.md">CFM-PAR-5-1985.md</a>
            </div>
          </body>
        </html>
      `;

      const skipped: { url: string; reason: string }[] = [];
      const discovered = LegalNormCrawlerService.discoverLinksFromHtml(
        mockGithubHtml,
        'https://github.com/md-augustolinhares/cfm-normas/tree/main/normas/pareceres/1985',
        0,
        [],
        [],
        skipped
      );

      // Deve ter descoberto os 2 arquivos e convertido para raw
      expect(discovered.length).toBe(2);
      expect(discovered[0].url).toBe(
        'https://raw.githubusercontent.com/md-augustolinhares/cfm-normas/main/normas/pareceres/1985/CFM-PAR-1-1985.md'
      );
      expect(discovered[0].fileType).toBe('markdown');
      expect(discovered[1].url).toBe(
        'https://raw.githubusercontent.com/md-augustolinhares/cfm-normas/main/normas/pareceres/1985/CFM-PAR-5-1985.md'
      );

      // Links de navegação do GitHub devem ter sido descartados
      expect(skipped.some((s) => s.reason.includes('GitHub'))).toBe(true);
    });
  });

  describe('3. Extração de Frontmatter YAML e Metadados Ricos de Pareceres', () => {
    const rawParecerMarkdown = `---
id: CFM-PAR-1-1985
id_norma_cfm: '28179'
orgao: CFM
tipo: Parecer
numero: '1'
ano: '1985'
data_publicacao: 15-SEP-16
status: Vigente
ementa: Projeto Lei sobre a fiscalizacao da producao de defensivos agricolas.
macro_tema: Ética Médica & Deontologia
url_original: https://sistemas.cfm.org.br/normas/visualizar/pareceres/BR/1985/1
url_pdf_original: https://sistemas.cfm.org.br/normas/arquivos/pareceres/BR/1985/1_1985.pdf
---

# PARECER CFM Nº 1/1985

## EMENTA
Projeto de Lei sobre a fiscalização da produção e comercialização de defensivos agrícolas.

## RELATÓRIO
O presente parecer versa sobre o Projeto de Lei que regulamenta defensivos agrícolas no território nacional.
Constatou-se a necessidade imperiosa de controle toxicológico para proteção da saúde pública.

## DO VOTO DO RELATOR
Diante das considerações expendidas pelo relator, vota-se pela aprovação do parecer com as salvaguardas sanitárias devidas.

## CONCLUSÃO
Aprovado em Sessão Plenária do Conselho Federal de Medicina em 15 de setembro de 1985.
`;

    it('deve extrair o frontmatter YAML preenchendo yamlMetadata e título formal', () => {
      const extracted = LegalNormCrawlerService.extractFromMarkdownText(
        'https://raw.githubusercontent.com/md-augustolinhares/cfm-normas/main/normas/pareceres/1985/CFM-PAR-1-1985.md',
        rawParecerMarkdown
      );

      expect(extracted.yamlMetadata).toBeDefined();
      expect(extracted.yamlMetadata?.id).toBe('CFM-PAR-1-1985');
      expect(extracted.yamlMetadata?.orgao).toBe('CFM');
      expect(extracted.yamlMetadata?.tipo).toBe('Parecer');
      expect(extracted.yamlMetadata?.numero).toBe('1');
      expect(extracted.yamlMetadata?.ano).toBe('1985');
      expect(extracted.yamlMetadata?.status).toBe('Vigente');
      expect(extracted.title).toContain('PARECER CFM Nº 1/1985');
      // O activeContentMd não deve conter as tags delimitadoras do YAML
      expect(extracted.activeContentMd).not.toContain('id_norma_cfm:');
      expect(extracted.activeContentMd).toContain('# PARECER CFM Nº 1/1985');
    });

    it('deve classificar o parecer como ato normativo válido sem penalidade por ausência de artigos', async () => {
      const extracted = LegalNormCrawlerService.extractFromMarkdownText(
        'https://raw.githubusercontent.com/md-augustolinhares/cfm-normas/main/normas/pareceres/1985/CFM-PAR-1-1985.md',
        rawParecerMarkdown
      );

      const classification = await LegalNormCrawlerService.classifyLegalNorm(extracted, ['cfm']);

      expect(classification.isNorm).toBe(true);
      expect(classification.score).toBeGreaterThanOrEqual(0.85);
      expect(classification.normType).toBe('parecer');
      expect(classification.number).toBe('1');
      expect(classification.year).toBe(1985);
      expect(classification.issuingBody).toBe('CFM');
      expect(classification.status).toBe('active');
      expect(classification.summary).toContain('defensivos');
    });

    it('deve particionar o parecer em chunks jurídicos pelas seções formais (Ementa, Relatório, Voto, Conclusão)', () => {
      const extracted = LegalNormCrawlerService.extractFromMarkdownText(
        'https://raw.githubusercontent.com/md-augustolinhares/cfm-normas/main/normas/pareceres/1985/CFM-PAR-1-1985.md',
        rawParecerMarkdown
      );

      const chunks = LegalNormCrawlerService.chunkLegalNormByArticle(extracted.title, extracted.activeContentMd);

      expect(chunks.length).toBeGreaterThanOrEqual(4);
      const contexts = chunks.map((c) => c.headingContext);
      expect(contexts.some((ctx) => ctx.includes('EMENTA'))).toBe(true);
      expect(contexts.some((ctx) => ctx.includes('RELATÓRIO'))).toBe(true);
      expect(contexts.some((ctx) => ctx.includes('VOTO'))).toBe(true);
      expect(contexts.some((ctx) => ctx.includes('CONCLUSÃO'))).toBe(true);
    });
  });
});
