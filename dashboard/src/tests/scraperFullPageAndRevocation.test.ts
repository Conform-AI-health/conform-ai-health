import { describe, it, expect } from 'vitest';
import { ScraperService } from '../services/scraperService.js';
import { LegalNormCrawlerService } from '../services/legalNormCrawlerService.js';

describe('ScraperService — Extração de Tags <a> e PDFs com Validação Estrita de Conteúdo (Tag + Lei) Sem Mocks de Firecrawl', () => {
  it('NÃO deve aprovar página HTML genérica apenas por ser de domínio oficial (ex: cfm.org.br) sem conteúdo de Lei + Tag', () => {
    const htmlMenuTitle = 'Portal CFM - Busca de Normas e Serviços';
    const htmlMenuContent = 'Bem-vindo ao portal institucional. Clique nos menus abaixo para navegar em nossos serviços.';

    const check = ScraperService.validateContentHasTagAndLawData(
      htmlMenuTitle,
      htmlMenuContent,
      ['CFM'],
      'https://portal.cfm.org.br/index.php'
    );
    expect(check.hasLawData).toBe(false);
    expect(check.isValid).toBe(false);
  });

  it('DEVE validar positivamente apenas quando o conteúdo do arquivo/link possuir dados da Tag setada E estrutura de Lei/Norma', () => {
    const validNormTitle = 'Resolução CFM nº 2.336/2023';
    const validNormContent = `
      RESOLUÇÃO CFM Nº 2.336/2023
      Dispõe sobre a publicidade e propaganda médicas.
      O CONSELHO FEDERAL DE MEDICINA, no uso das atribuições conferidas pela Lei nº 3.268/1957, RESOLVE:
      Art. 1º O médico deve declarar seu CRM e RQE em toda peça de publicidade médica.
    `;

    // Válido para a tag CFM
    const validForCfm = ScraperService.validateContentHasTagAndLawData(
      validNormTitle,
      validNormContent,
      ['CFM'],
      'https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2023/2336'
    );
    expect(validForCfm.hasLawData).toBe(true);
    expect(validForCfm.hasTagData).toBe(true);
    expect(validForCfm.isValid).toBe(true);

    // Inválido se o usuário setou apenas a tag ANVISA e o texto não trata de ANVISA
    const invalidForAnvisa = ScraperService.validateContentHasTagAndLawData(
      validNormTitle,
      validNormContent,
      ['ANVISA'],
      'https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2023/2336'
    );
    expect(invalidForAnvisa.hasLawData).toBe(true);
    expect(invalidForAnvisa.hasTagData).toBe(false);
    expect(invalidForAnvisa.isValid).toBe(false);
  });

  it('NÃO deve marcar como REVOGADO normas vigentes que contêm "Fica revogada a Resolução anterior"', () => {
    const activeNormTitle = 'Resolução CFM nº 2.336/2023 - Publicidade Médica';
    const activeNormBody = `
      Dispõe sobre a publicidade e propaganda médicas.
      Art. 1º É permitido ao médico divulgar seu trabalho.
      Art. 16º Fica revogada a Resolução CFM nº 1.974/2011 e revogam-se as disposições em contrário.
    `;

    expect(ScraperService.isExplicitlyRevokedNorm(activeNormTitle, activeNormBody)).toBe(false);
    const tags = ScraperService.detectRegulatoryTags(activeNormBody, `<p>${activeNormBody}</p>`);
    expect(tags).toContain('CFM');
    expect(tags).not.toContain('REVOGADO');
  });

  it('DEVE extrair tags <a href> e links que contêm .pdf da página HTML priorizando documentos das tags setadas', () => {
    const html = `
      <html>
        <body>
          <nav><a href="/login">Login</a></nav>
          <div class="lista-arquivos">
            <a href="/arquivos/parecer-telemedicina.pdf">Parecer CFM Telemedicina (PDF)</a>
            <a href="/normas/resolucao-2336">Resolução CFM nº 2.336/2023</a>
          </div>
        </body>
      </html>
    `;

    const extracted = LegalNormCrawlerService.discoverLinksFromHtml(
      html,
      'https://sistemas.cfm.org.br/portal/busca.html'
    );

    expect(extracted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://sistemas.cfm.org.br/arquivos/parecer-telemedicina.pdf',
          anchorText: 'Parecer CFM Telemedicina (PDF)',
          fileType: 'pdf',
        }),
        expect.objectContaining({
          url: 'https://sistemas.cfm.org.br/normas/resolucao-2336',
          anchorText: 'Resolução CFM nº 2.336/2023',
          fileType: 'html',
        }),
      ])
    );
  });
});
