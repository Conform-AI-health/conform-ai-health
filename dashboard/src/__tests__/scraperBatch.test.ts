import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { ScraperService } from '../services/scraperService.js';

describe('🕷️ ScraperService - Varredura em Lote e Diretórios GitHub', () => {
  it('deve reconhecer URLs de árvores do GitHub e extrair parâmetros de caminho', () => {
    const treeUrl = 'https://github.com/md-augustolinhares/cfm-normas/tree/main/normas/resolucoes/1957';
    const parsed = ScraperService.isGitHubTreeUrl(treeUrl);

    expect(parsed.isTree).toBe(true);
    expect(parsed.owner).toBe('md-augustolinhares');
    expect(parsed.repo).toBe('cfm-normas');
    expect(parsed.branch).toBe('main');
    expect(parsed.path).toBe('normas/resolucoes/1957');
  });

  it('deve retornar isTree: false para páginas normais de hospitais/clínicas', () => {
    const normalUrl = 'https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2023/2336';
    const parsed = ScraperService.isGitHubTreeUrl(normalUrl);

    expect(parsed.isTree).toBe(false);
  });

  it('deve reconhecer arquivos blob individuais do GitHub', () => {
    const blobUrl = 'https://github.com/md-augustolinhares/cfm-normas/blob/main/normas/resolucoes/1957/CFM-RES-1-1957.md';
    const parsed = ScraperService.isGitHubBlobUrl(blobUrl);

    expect(parsed.isBlob).toBe(true);
    expect(parsed.owner).toBe('md-augustolinhares');
    expect(parsed.repo).toBe('cfm-normas');
    expect(parsed.branch).toBe('main');
    expect(parsed.path).toBe('normas/resolucoes/1957/CFM-RES-1-1957.md');
  });

  it('deve taguear automaticamente resoluções com termos médicos como CFM', () => {
    const content = '# Resolução CFM nº 1/1957\nO Conselho Federal de Medicina estabelece normas sobre CRM e RQE.';
    const tags = ScraperService.detectRegulatoryTags(content, '');

    expect(tags).toContain('CFM');
  });

  it('deve reconhecer URLs do Diário Oficial da União (in.gov.br)', () => {
    const douUrl = 'https://www.in.gov.br/leiturajornal?secao=dou1&data=29-10-2026&org=Minist%C3%A9rio%20da%20Sa%C3%BAde&ato=Resolu%C3%A7%C3%A3o#daypicker';
    expect(ScraperService.isDouUrl(douUrl)).toBe(true);

    const normalWebUrl = 'https://clinicaexemplo.com.br/sobre';
    expect(ScraperService.isDouUrl(normalWebUrl)).toBe(false);
  });

  it('deve converter blocos HTML em Markdown limpo estruturado via htmlToMarkdown', () => {
    const html = '<h1>RESOLUÇÃO Nº 500</h1><p>Art. 1º Fica vedada publicidade sem CRM.</p><p>Art. 2º Informar RQE obrigatório.</p>';
    const md = ScraperService.htmlToMarkdown(html);

    expect(md).toContain('# RESOLUÇÃO Nº 500');
    expect(md).toContain('Art. 1º Fica vedada publicidade sem CRM.');
    expect(md).toContain('Art. 2º Informar RQE obrigatório.');
  });

  it('deve extrair entidades médicas (CRM, RQE, estados) e heurísticas deontológicas', () => {
    const text = 'Médico responsável: Dr. Silva CRM/SP 12345 e RQE 54321. Promoção com 50% de desconto e resultado garantido antes e depois.';
    const entities = ScraperService.extractEntities(text, '');

    expect(entities.crms.length).toBeGreaterThan(0);
    expect(entities.rqes.length).toBeGreaterThan(0);
    expect(entities.states).toContain('SP');
    expect(entities.hasPromotionalPricing).toBe(true);
    expect(entities.hasGuaranteedResultMention).toBe(true);
    expect(entities.hasBeforeAfterMention).toBe(true);
  });

  it('deve processar página do DOU com jsonArray gerando documentos individuais para cada resolução', async () => {
    const fakeDouHtml = `
      <html>
        <head><title>Diário Oficial da União - Seção 1</title></head>
        <body>
          <script id="params" type="application/json">
          {
            "jsonArray": [
              {
                "identifica": "RESOLUÇÃO MS Nº 1.000, DE 29 DE OUTUBRO DE 2026",
                "title": "RESOLUÇÃO MS Nº 1.000",
                "urlTitle": "resolucao-ms-n-1000-de-29-de-outubro-de-2026-123456",
                "artType": "Resolução",
                "orgao": "Ministério da Saúde / Gabinete da Ministra",
                "pubDate": "29/10/2026",
                "numberPage": "45",
                "desSummary": "Dispõe sobre telemedicina e conformidade de dados sensíveis.",
                "texto": "<p class='dou-paragraph'>Art. 1º É obrigatória a proteção de dados segundo a LGPD e registro no CFM com CRM.</p>"
              },
              {
                "identifica": "RESOLUÇÃO MS Nº 1.001, DE 29 DE OUTUBRO DE 2026",
                "title": "RESOLUÇÃO MS Nº 1.001",
                "urlTitle": "resolucao-ms-n-1001-de-29-de-outubro-de-2026-123457",
                "artType": "Resolução",
                "orgao": "Ministério da Saúde / Secretaria de Atenção Primária",
                "pubDate": "29/10/2026",
                "numberPage": "48",
                "desSummary": "Estabelece diretrizes para exames laboratoriais.",
                "texto": "<p class='dou-paragraph'>Art. 1º Procedimentos médicos devem respeitar boas práticas sanitárias da ANVISA.</p>"
              }
            ]
          }
          </script>
        </body>
      </html>
    `;

    const getSpy = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      data: fakeDouHtml,
      status: 200,
    } as any);

    const targetUrl = 'https://www.in.gov.br/leiturajornal?secao=dou1&data=29-10-2026&org=Minist%C3%A9rio%20da%20Sa%C3%BAde&ato=Resolu%C3%A7%C3%A3o#daypicker';
    const results = await ScraperService.scrapeDouLeituraJornal(targetUrl);

    expect(results).toHaveLength(2);

    // Documento 1
    expect(results[0].title).toBe('RESOLUÇÃO MS Nº 1.000, DE 29 DE OUTUBRO DE 2026');
    expect(results[0].url).toContain('resolucao-ms-n-1000');
    expect(results[0].cleanMarkdown).toContain('Ministério da Saúde');
    expect(results[0].cleanMarkdown).toContain('telemedicina');
    expect(results[0].detectedTags).toContain('LGPD');
    expect(results[0].detectedTags).toContain('CFM');

    // Documento 2
    expect(results[1].title).toBe('RESOLUÇÃO MS Nº 1.001, DE 29 DE OUTUBRO DE 2026');
    expect(results[1].url).toContain('resolucao-ms-n-1001');
    expect(results[1].cleanMarkdown).toContain('ANVISA');
    expect(results[1].detectedTags).toContain('ANVISA');

    getSpy.mockRestore();
  });
});

