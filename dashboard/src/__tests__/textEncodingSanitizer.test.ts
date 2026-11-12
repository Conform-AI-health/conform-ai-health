import { describe, it, expect } from 'vitest';
import { TextEncodingSanitizer } from '../shared/textEncodingSanitizer.js';
import { ScraperService } from '../services/scraperService.js';

describe('TextEncodingSanitizer - Normalização Universal de Acentuação e Encoding (T36)', () => {
  describe('1. Caso Real Específico: Lei 13.709/2018 (LGPD - Portal do Planalto)', () => {
    it('deve restaurar com perfeição o cabeçalho corrompido da Lei 13.709 antes de salvar no database', () => {
      const inputCorrupted = [
        'Presidncia da Repblica Secretaria-Geral Subchefia para Assuntos Jurdicos',
        '',
        'LEI N 13.709, DE 14 DE AGOSTO DE 2018',
        '',
        'Texto compilado antes de salvar o doc no database',
      ].join('\n');

      const expectedRestored = [
        'Presidência da República Secretaria-Geral Subchefia para Assuntos Jurídicos',
        '',
        'LEI Nº 13.709, DE 14 DE AGOSTO DE 2018',
        '',
        'Texto compilado antes de salvar o doc no database',
      ].join('\n');

      const result = TextEncodingSanitizer.sanitizeAndRepairText(inputCorrupted);
      expect(result).toBe(expectedRestored);
    });

    it('deve restaurar cabeçalho mesmo quando os caracteres corrompidos forem removidos ou omitidos', () => {
      const inputOmitted = 'Presidncia da Repblica Secretaria-Geral Subchefia para Assuntos Jurdicos LEI N 13.709, DE 14 DE AGOSTO DE 2018 Texto compilado';
      const result = TextEncodingSanitizer.sanitizeAndRepairText(inputOmitted);

      expect(result).toContain('Presidência da República');
      expect(result).toContain('Subchefia para Assuntos Jurídicos');
      expect(result).toContain('LEI Nº 13.709');
      expect(result).toContain('Texto compilado');
    });
  });

  describe('2. Reparo Universal de Mojibake UTF-8 / ISO-8859-1', () => {
    it('deve corrigir sequências comuns de mojibake de acentuação em português', () => {
      const mojibakeText = 'A resoluÃ§Ã£o de publicidade mÃ©dica nÂº 2.336/2023 proÃ­be autopromoÃ§Ã£o sensacionalista â€œantes e depoisâ€.';
      const repaired = TextEncodingSanitizer.sanitizeAndRepairText(mojibakeText);

      expect(repaired).toBe('A resolução de publicidade médica Nº 2.336/2023 proíbe autopromoção sensacionalista “antes e depois”.');
    });

    it('deve corrigir acentos maiúsculos e minúsculos com sinais diacríticos (ã, õ, á, é, í, ó, ú, ç, â, ê)', () => {
      const input = 'Ã rea de AtuaÃ§Ã£o: Cardiologia, SaÃºde PÃºblica, ProteÃ§Ã£o de Dados e VigilÃ¢ncia SanitÃ¡ria.';
      const repaired = TextEncodingSanitizer.sanitizeAndRepairText(input);

      expect(repaired).toContain('Área de Atuação');
      expect(repaired).toContain('Saúde Pública');
      expect(repaired).toContain('Proteção de Dados');
      expect(repaired).toContain('Vigilância Sanitária');
    });
  });

  describe('3. Decodificação de Entidades HTML', () => {
    it('deve decodificar entidades HTML para caracteres UTF-8 reais', () => {
      const htmlEntityText = 'Resolu&ccedil;&atilde;o CFM &ordm; 2336 &ndash; Artigo 11&ordm; &amp; &sect; 1&ordm;.';
      const result = TextEncodingSanitizer.sanitizeAndRepairText(htmlEntityText);

      expect(result).toBe('Resolução CFM º 2336 – Artigo 11º & § 1º.');
    });
  });

  describe('4. Reconstrução de Termos Jurídicos e Regulatórios', () => {
    it('deve reconstruir vocabulário canônico de leis e resoluções que perderam acentos', () => {
      const legalText = 'Resoluo CFM, Captulo II, Pargrafo 1: So infraes deontolgicas graves sem autorizao.';
      const result = TextEncodingSanitizer.sanitizeAndRepairText(legalText);

      expect(result).toContain('Resolução');
      expect(result).toContain('Capítulo');
      expect(result).toContain('Parágrafo');
      expect(result).toContain('infrações');
      expect(result).toContain('deontológicas');
      expect(result).toContain('autorização');
    });
  });

  describe('5. Decodificação Adaptativa de Buffer HTTP (decodeBufferWithAutoEncoding)', () => {
    it('deve decodificar corretamente buffer codificado em ISO-8859-1 (Latin1) típico do Planalto', () => {
      // Simula os bytes da palavra "Presidência da República - LEI Nº 13.709" em ISO-8859-1:
      // 'ê' = 0xEA, 'ú' = 0xFA, 'º' = 0xBA
      const isoBytes = Buffer.from([
        0x50, 0x72, 0x65, 0x73, 0x69, 0x64, 0xEA, 0x6E, 0x63, 0x69, 0x61, // Presidência
        0x20, 0x64, 0x61, 0x20,                                           //  da 
        0x52, 0x65, 0x70, 0xFA, 0x62, 0x6C, 0x69, 0x63, 0x61,             // República
        0x20, 0x2D, 0x20, 0x4C, 0x45, 0x49, 0x20, 0x4E, 0xBA, 0x20,       //  - LEI Nº 
        0x31, 0x33, 0x2E, 0x37, 0x30, 0x39,                               // 13.709
      ]);

      const decoded = TextEncodingSanitizer.decodeBufferWithAutoEncoding(
        isoBytes,
        'text/html; charset=iso-8859-1'
      );

      expect(decoded).toContain('Presidência da República');
      expect(decoded).toContain('LEI Nº 13.709');
    });

    it('deve detectar tag <meta charset="iso-8859-1"> dentro do HTML mesmo sem header Content-Type explícito', () => {
      const htmlIsoSnippet = '<!DOCTYPE html><html><head><meta http-equiv="content-type" content="text/html; charset=iso-8859-1"><title>Lei</title></head><body>Presidência</body></html>';
      const latin1Buffer = Buffer.from(htmlIsoSnippet, 'latin1');

      const result = TextEncodingSanitizer.decodeBufferWithAutoEncoding(latin1Buffer);
      expect(result).toContain('Presidência');
    });
  });

  describe('6. Integração com ScraperService.processHtml', () => {
    it('deve entregar title e cleanMarkdown com acentos impecáveis após processamento', () => {
      const rawHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Presidncia da Repblica - LEI N 13.709</title>
        </head>
        <body>
          <h1>LEI N 13.709, DE 14 DE AGOSTO DE 2018</h1>
          <p>Dispe sobre a proteo de dados pessoais e altera a Lei n 12.965.</p>
        </body>
        </html>
      `;

      const result = ScraperService.processHtml(
        'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm',
        rawHtml,
        'CHEERIO'
      );

      expect(result.title).toContain('Presidência da República');
      expect(result.title).toContain('LEI Nº 13.709');
      expect(result.cleanMarkdown).toContain('LEI Nº 13.709');
      expect(result.cleanMarkdown).toContain('proteção de dados');
    });
  });

  describe('7. Caso Real: Dispositivos de Lei com Caracteres de Substituição (\uFFFD / )', () => {
    it('deve restaurar a acentuação completa de dispositivos legais e órgãos da administração pública', () => {
      const inputCorrupted =
        'I - os rgos pblicos integrantes da administrao direta dos Poderes Executivo, Legislativo, incluindo as Cortes de Contas, e Judicirio e do Ministrio Pblico;';

      const expected =
        'I - os órgãos públicos integrantes da administração direta dos Poderes Executivo, Legislativo, incluindo as Cortes de Contas, e Judiciário e do Ministério Público;';

      const result = TextEncodingSanitizer.sanitizeAndRepairText(inputCorrupted);
      expect(result).toBe(expected);
    });
  });
});
