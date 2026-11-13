/**
 * TextEncodingSanitizer - Normalização e Reparo Universal de Acentuação e Encoding (Anti-Mojibake)
 * 
 * Garante que textos de normas legais (como a Lei 13.709/2018 - LGPD), resoluções e documentos de saúde
 * preservem rigorosamente sua acentuação, ortografia e integridade fonética em português antes de
 * serem persistidos no banco de dados.
 */

function matchCase(original: string, standardReplacement: string): string {
  if (!original || !standardReplacement) return standardReplacement;

  // Localiza a primeira letra alfabética para determinar com precisão a caixa alta/baixa
  let firstAlpha = '';
  for (const ch of original) {
    if (/[a-zA-ZáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ]/.test(ch)) {
      firstAlpha = ch;
      break;
    }
  }

  const isFirstUpper = Boolean(firstAlpha && firstAlpha === firstAlpha.toUpperCase());
  const lettersOnly = original.replace(/[^a-zA-ZáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ]/g, '');
  const isAllUpper = lettersOnly.length > 1 && lettersOnly === lettersOnly.toUpperCase();

  if (isAllUpper) {
    return standardReplacement.toUpperCase();
  }
  if (isFirstUpper) {
    return standardReplacement.charAt(0).toUpperCase() + standardReplacement.slice(1);
  }
  return standardReplacement.charAt(0).toLowerCase() + standardReplacement.slice(1);
}

export class TextEncodingSanitizer {
  /**
   * Mapeamento de pares de Mojibake UTF-8 decodificados erroneamente como ISO-8859-1 / Windows-1252
   */
  private static readonly MOJIBAKE_MAP: [RegExp, string][] = [
    // Bytes de controle maiúsculos UTF-8 lidos em Latin1
    [/Ã[\u0081\u00A0\x81]/g, 'Á'],
    [/Ã[\u0080\x80]/g, 'À'],
    [/Ã[\u0082\x82]/g, 'Â'],
    [/Ã[\u0083\x83]/g, 'Ã'],
    [/Ã[\u0089\x89]/g, 'É'],
    [/Ã[\u008A\x8A]/g, 'Ê'],
    [/Ã[\u008D\x8D]/g, 'Í'],
    [/Ã[\u0093\x93]/g, 'Ó'],
    [/Ã[\u0094\x94]/g, 'Ô'],
    [/Ã[\u0095\x95]/g, 'Õ'],
    [/Ã[\u009A\x9A]/g, 'Ú'],
    [/Ã[\u0087\x87]/g, 'Ç'],
    [/Ã\s+rea/g, 'Área'],
    [/Ã rea/g, 'Área'],

    // Minúsculos UTF-8 lidos em Latin1
    [/Ã¡/g, 'á'],
    [/Ã /g, 'à'],
    [/Ã£/g, 'ã'],
    [/Ã¢/g, 'â'],
    [/Ã©/g, 'é'],
    [/Ãª/g, 'ê'],
    [/Ã­/g, 'í'],
    [/Ã³/g, 'ó'],
    [/Ãµ/g, 'õ'],
    [/Ã´/g, 'ô'],
    [/Ãº/g, 'ú'],
    [/Ã¼/g, 'ü'],
    [/Ã§/g, 'ç'],
    [/ÃÁ/g, 'Á'],
    [/Ãƒ/g, 'Ã'],
    [/Ã‚/g, 'Â'],
    [/Ã‰/g, 'É'],
    [/ÃŠ/g, 'Ê'],
    [/Ã“/g, 'Ó'],
    [/Ã•/g, 'Õ'],
    [/Ã”/g, 'Ô'],
    [/Ãš/g, 'Ú'],
    [/Ã‡/g, 'Ç'],
    [/NÂº/gi, 'Nº'],
    [/NÂ°/gi, 'Nº'],
    [/Âº/g, 'º'],
    [/Â°/g, '°'],
    [/Â§/g, '§'],
    [/â€“/g, '–'],
    [/â€”/g, '—'],
    [/â€œ/g, '“'],
    [/â€/g, '”'],
    [/â€˜/g, '‘'],
    [/â€™/g, '’'],
    [/â€¢/g, '•'],
    [/Â/g, ' '],
  ];

  /**
   * Mapeamento de entidades HTML comuns para caracteres acentuados reais
   */
  private static readonly HTML_ENTITIES_MAP: [RegExp, string][] = [
    [/&amp;/gi, '&'],
    [/&aacute;/gi, 'á'],
    [/&agrave;/gi, 'à'],
    [/&atilde;/gi, 'ã'],
    [/&acirc;/gi, 'â'],
    [/&eacute;/gi, 'é'],
    [/&ecirc;/gi, 'ê'],
    [/&iacute;/gi, 'í'],
    [/&oacute;/gi, 'ó'],
    [/&otilde;/gi, 'õ'],
    [/&ocirc;/gi, 'ô'],
    [/&uacute;/gi, 'ú'],
    [/&uuml;/gi, 'ü'],
    [/&ccedil;/gi, 'ç'],
    [/&Aacute;/g, 'Á'],
    [/&Agrave;/g, 'À'],
    [/&Atilde;/g, 'Ã'],
    [/&Acirc;/g, 'Â'],
    [/&Eacute;/g, 'É'],
    [/&Ecirc;/g, 'Ê'],
    [/&Iacute;/g, 'Í'],
    [/&Oacute;/g, 'Ó'],
    [/&Otilde;/g, 'Õ'],
    [/&Ocirc;/g, 'Ô'],
    [/&Uacute;/g, 'Ú'],
    [/&Ccedil;/g, 'Ç'],
    [/&ordm;/gi, 'º'],
    [/&ordf;/gi, 'ª'],
    [/&sect;/gi, '§'],
    [/&bull;/gi, '•'],
    [/&ndash;/gi, '–'],
    [/&mdash;/gi, '—'],
    [/&quot;/gi, '"'],
    [/&#186;/g, 'º'],
    [/&#170;/g, 'ª'],
    [/&#167;/g, '§'],
  ];

  /**
   * Dicionário canônico de reconstrução de acentuações para termos jurídicos, normativos e institucionais
   * especialmente afetados por perda de bytes / caracteres de substituição (\uFFFD / '').
   */
  private static readonly CANONICAL_LEGAL_TERMS: [RegExp, (m: string, ...args: any[]) => string][] = [
    // Cabeçalho Oficial do Poder Executivo / Planalto (Exemplo da Lei 13.709 e Decretos)
    [/Presid[^\w\s]?ncia\s+da\s+Rep[^\w\s]?blica/gi, () => 'Presidência da República'],
    [/Subchefia\s+para\s+Assuntos\s+Jur[^\w\s]?dicos/gi, () => 'Subchefia para Assuntos Jurídicos'],
    [/Secretaria-Geral/gi, () => 'Secretaria-Geral'],
    [/LEI\s+N[^\w\s\d]?\s*([0-9]{1,3}(?:\.[0-9]{3})*)/gi, (_, num) => `LEI Nº ${num}`],
    [/Texto\s+compilado/gi, () => 'Texto compilado'],

    // Dispositivo inicial de leis (Dispõe sobre...)
    [/\bDisp[^\w\s]?e\s+sobre\b/gi, (m) => matchCase(m, 'Dispõe sobre')],

    // Atos e Termos Normativos Gerais (preservando rigorosamente o case do texto original)
    [/\bResolu[^\w\s]?o\b/gi, (m) => matchCase(m, 'resolução')],
    [/\bResolu[^\w\s]?[^\w\s]?es\b/gi, (m) => matchCase(m, 'resoluções')],
    [/\bPresid[^\w\s]?ncia\b/gi, (m) => matchCase(m, 'presidência')],
    [/\bRep[^\w\s]?blica\b/gi, (m) => matchCase(m, 'república')],
    [/\bJur[^\w\s]?dico\b/gi, (m) => matchCase(m, 'jurídico')],
    [/\bJur[^\w\s]?dicos\b/gi, (m) => matchCase(m, 'jurídicos')],
    [/\bJur[^\w\s]?dica\b/gi, (m) => matchCase(m, 'jurídica')],
    [/\bJur[^\w\s]?dicas\b/gi, (m) => matchCase(m, 'jurídicas')],
    [/\bSe[^\w\s]?o\b/gi, (m) => matchCase(m, 'seção')],
    [/\bSe[^\w\s]?[^\w\s]?es\b/gi, (m) => matchCase(m, 'seções')],
    [/\bCap[^\w\s]?tulo\b/gi, (m) => matchCase(m, 'capítulo')],
    [/\bCap[^\w\s]?tulos\b/gi, (m) => matchCase(m, 'capítulos')],
    [/\bPar[^\w\s]?grafo\b/gi, (m) => matchCase(m, 'parágrafo')],
    [/\bPar[^\w\s]?grafos\b/gi, (m) => matchCase(m, 'parágrafos')],
    [/\bArt[^\w\s]?\s*(\d+)/gi, (_, num) => `Art. ${num}`],
    [/\bDisposi[^\w\s]?[^\w\s]?es\b/gi, (m) => matchCase(m, 'disposições')],
    [/\bTransit[^\w\s]?rio\b/gi, (m) => matchCase(m, 'transitório')],
    [/\bTransit[^\w\s]?rios\b/gi, (m) => matchCase(m, 'transitórios')],
    [/\bTransit[^\w\s]?ria\b/gi, (m) => matchCase(m, 'transitória')],
    [/\bTransit[^\w\s]?rias\b/gi, (m) => matchCase(m, 'transitórias')],
    [/\bSan[^\w\s]?o\b/gi, (m) => matchCase(m, 'sanção')],
    [/\bSan[^\w\s]?[^\w\s]?es\b/gi, (m) => matchCase(m, 'sanções')],
    [/\bProte[^\w\s]?o\b/gi, (m) => matchCase(m, 'proteção')],
    [/\bAutoriza[^\w\s]?o\b/gi, (m) => matchCase(m, 'autorização')],
    [/\bAtribui[^\w\s]?[^\w\s]?es\b/gi, (m) => matchCase(m, 'atribuições')],
    [/\bConstitui[^\w\s]?o\b/gi, (m) => matchCase(m, 'constituição')],
    [/\bLegisla[^\w\s]?o\b/gi, (m) => matchCase(m, 'legislação')],
    [/\bVig[^\w\s]?ncia\b/gi, (m) => matchCase(m, 'vigência')],
    [/\bRevoga[^\w\s]?o\b/gi, (m) => matchCase(m, 'revogação')],
    [/\bPublica[^\w\s]?o\b/gi, (m) => matchCase(m, 'publicação')],
    [/\bReda[^\w\s]?o\b/gi, (m) => matchCase(m, 'redação')],
    [/\bInfra[^\w\s]?o\b/gi, (m) => matchCase(m, 'infração')],
    [/\bInfra[^\w\s]?[^\w\s]?es\b/gi, (m) => matchCase(m, 'infrações')],
    [/\bDeontol[^\w\s]?gico\b/gi, (m) => matchCase(m, 'deontológico')],
    [/\bDeontol[^\w\s]?gicos\b/gi, (m) => matchCase(m, 'deontológicos')],
    [/\bDeontol[^\w\s]?gica\b/gi, (m) => matchCase(m, 'deontológica')],
    [/\bDeontol[^\w\s]?gicas\b/gi, (m) => matchCase(m, 'deontológicas')],
    [/\bM[^\w\s]?dico\b/gi, (m) => matchCase(m, 'médico')],
    [/\bM[^\w\s]?dicos\b/gi, (m) => matchCase(m, 'médicos')],
    [/\bM[^\w\s]?dica\b/gi, (m) => matchCase(m, 'médica')],
    [/\bM[^\w\s]?dicas\b/gi, (m) => matchCase(m, 'médicas')],
    [/\bSa[^\w\s]?de\b/gi, (m) => matchCase(m, 'saúde')],

    // Órgãos e Órgão (suporta início com \uFFFD,  ou sem o 'o' inicial)
    [/(?<=\s|^|[^\w])(?:[^\w\s]|[\uFFFD])?rg(?:[^\w\s]|[\uFFFD])?os\b/gi, (m) => matchCase(m, 'órgãos')],
    [/(?<=\s|^|[^\w])(?:[^\w\s]|[\uFFFD])?rg(?:[^\w\s]|[\uFFFD])?o\b/gi, (m) => matchCase(m, 'órgão')],
    [/\b[OÓoó]rg[^\w\s]?os\b/gi, (m) => matchCase(m, 'órgãos')],
    [/\b[OÓoó]rg[^\w\s]?o\b/gi, (m) => matchCase(m, 'órgão')],

    // Público / Pública / Públicos / Públicas
    [/\bp(?:[^\w\s]|[\uFFFD])?blicos\b/gi, (m) => matchCase(m, 'públicos')],
    [/\bp(?:[^\w\s]|[\uFFFD])?blico\b/gi, (m) => matchCase(m, 'público')],
    [/\bp(?:[^\w\s]|[\uFFFD])?blicas\b/gi, (m) => matchCase(m, 'públicas')],
    [/\bp(?:[^\w\s]|[\uFFFD])?blica\b/gi, (m) => matchCase(m, 'pública')],

    // Administração e Administrações (suporta com 1 ou 2 caracteres corrompidos, ou caracteres omitidos)
    [/\badministra(?:[^\w\s]|[\uFFFD]){0,2}o\b/gi, (m) => matchCase(m, 'administração')],
    [/\badministra(?:[^\w\s]|[\uFFFD]){0,2}es\b/gi, (m) => matchCase(m, 'administrações')],

    // Judiciário / Judiciária
    [/\bjudici(?:[^\w\s]|[\uFFFD])?rios\b/gi, (m) => matchCase(m, 'judiciários')],
    [/\bjudici(?:[^\w\s]|[\uFFFD])?rio\b/gi, (m) => matchCase(m, 'judiciário')],
    [/\bjudici(?:[^\w\s]|[\uFFFD])?rias\b/gi, (m) => matchCase(m, 'judiciárias')],
    [/\bjudici(?:[^\w\s]|[\uFFFD])?ria\b/gi, (m) => matchCase(m, 'judiciária')],

    // Ministério / Ministérios
    [/\bminist(?:[^\w\s]|[\uFFFD])?rios\b/gi, (m) => matchCase(m, 'ministérios')],
    [/\bminist(?:[^\w\s]|[\uFFFD])?rio\b/gi, (m) => matchCase(m, 'ministério')],

    // Outros termos do vocabulário normativo e deontológico
    [/\brelat(?:[^\w\s]|[\uFFFD])?rios\b/gi, (m) => matchCase(m, 'relatórios')],
    [/\brelat(?:[^\w\s]|[\uFFFD])?rio\b/gi, (m) => matchCase(m, 'relatório')],
    [/\bobrigat(?:[^\w\s]|[\uFFFD])?ri(o|a|os|as)\b/gi, (m) => matchCase(m, m.toLowerCase().includes('as') ? 'obrigatórias' : m.toLowerCase().includes('os') ? 'obrigatórios' : m.toLowerCase().endsWith('a') ? 'obrigatória' : 'obrigatório')],
    [/\bnecess(?:[^\w\s]|[\uFFFD])?ri(o|a|os|as)\b/gi, (m) => matchCase(m, m.toLowerCase().includes('as') ? 'necessárias' : m.toLowerCase().includes('os') ? 'necessários' : m.toLowerCase().endsWith('a') ? 'necessária' : 'necessário')],
    [/\bsecret(?:[^\w\s]|[\uFFFD])?ri(o|a|os|as)\b/gi, (m) => matchCase(m, m.toLowerCase().includes('as') ? 'secretárias' : m.toLowerCase().includes('os') ? 'secretários' : m.toLowerCase().endsWith('a') ? 'secretária' : 'secretário')],
    [/\bpr(?:[^\w\s]|[\uFFFD])?pri(o|a|os|as)\b/gi, (m) => matchCase(m, m.toLowerCase().includes('as') ? 'próprias' : m.toLowerCase().includes('os') ? 'próprios' : m.toLowerCase().endsWith('a') ? 'própria' : 'próprio')],
    [/\bpol(?:[^\w\s]|[\uFFFD])?tic(o|a|os|as)\b/gi, (m) => matchCase(m, m.toLowerCase().includes('as') ? 'políticas' : m.toLowerCase().includes('os') ? 'políticos' : m.toLowerCase().endsWith('a') ? 'política' : 'político')],
    [/\becon(?:[^\w\s]|[\uFFFD])?mic(o|a|os|as)\b/gi, (m) => matchCase(m, m.toLowerCase().includes('as') ? 'econômicas' : m.toLowerCase().includes('os') ? 'econômicos' : m.toLowerCase().endsWith('a') ? 'econômica' : 'econômico')],
    [/\bcl(?:[^\w\s]|[\uFFFD])?nic(o|a|os|as)\b/gi, (m) => matchCase(m, m.toLowerCase().includes('as') ? 'clínicas' : m.toLowerCase().includes('os') ? 'clínicos' : m.toLowerCase().endsWith('a') ? 'clínica' : 'clínico')],
    [/\bdiagn(?:[^\w\s]|[\uFFFD])?stic(o|a|os|as)\b/gi, (m) => matchCase(m, m.toLowerCase().includes('as') ? 'diagnósticas' : m.toLowerCase().includes('os') ? 'diagnósticos' : m.toLowerCase().endsWith('a') ? 'diagnóstica' : 'diagnóstico')],
    [/\bc(?:[^\w\s]|[\uFFFD])?dig(o|os)\b/gi, (m) => matchCase(m, m.toLowerCase().endsWith('s') ? 'códigos' : 'código')],
    [/\bn(?:[^\w\s]|[\uFFFD])?mer(o|os)\b/gi, (m) => matchCase(m, m.toLowerCase().endsWith('s') ? 'números' : 'número')],

    [/\b[Uu]ni[^\w\s]?o\b/gi, (m) => matchCase(m, 'união')],
    [/\b[Nn][^\w\s\d]?\s*([0-9]+)/gi, (match, num) => match[0] === 'N' ? `Nº ${num}` : `nº ${num}`],
  ];

  /**
   * Corrige sequências de mojibake decorrentes de decodificação cruzada UTF-8 / ISO-8859-1
   */
  public static repairMojibake(text: string): string {
    if (!text || typeof text !== 'string') return '';
    let result = text;
    for (const [pattern, replacement] of this.MOJIBAKE_MAP) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  /**
   * Converte entidades HTML para caracteres reais
   */
  public static decodeHtmlEntities(text: string): string {
    if (!text || typeof text !== 'string') return '';
    let result = text;
    for (const [pattern, replacement] of this.HTML_ENTITIES_MAP) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  /**
   * Recupera termos jurídicos e acentuações canônicas de legislação que perderam caracteres por encoding
   */
  public static repairCorruptedLegalAccents(text: string): string {
    if (!text || typeof text !== 'string') return '';
    let result = text;
    for (const [pattern, handler] of this.CANONICAL_LEGAL_TERMS) {
      result = result.replace(pattern, handler);
    }
    return result;
  }

  /**
   * Decodifica buffers brutos de resposta HTTP detectando automaticamente o charset informado
   * no header ou na tag <meta> do HTML (ISO-8859-1, Windows-1252 ou UTF-8)
   */
  public static decodeBufferWithAutoEncoding(buffer: Buffer, contentType?: string): string {
    if (!buffer || buffer.length === 0) return '';

    // 1. Checa BOM (Byte Order Mark)
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return buffer.subarray(3).toString('utf-8');
    }
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return buffer.subarray(2).toString('utf16le');
    }

    // 2. Inspeciona o cabeçalho Content-Type
    const headerLower = (contentType || '').toLowerCase();
    const isHeaderLatin1 = headerLower.includes('iso-8859-1') || headerLower.includes('windows-1252');

    // 3. Inspeciona os primeiros 8000 bytes em busca de <meta charset> ou <meta http-equiv="content-type">
    const peek = buffer.subarray(0, Math.min(buffer.length, 8000)).toString('ascii').toLowerCase();
    const isMetaLatin1 =
      peek.includes('charset=iso-8859-1') ||
      peek.includes('charset="iso-8859-1"') ||
      peek.includes("charset='iso-8859-1'") ||
      peek.includes('charset=windows-1252') ||
      peek.includes('charset="windows-1252"') ||
      peek.includes("charset='windows-1252'");

    if (isHeaderLatin1 || isMetaLatin1) {
      try {
        const latinDecoded = new TextDecoder('latin1').decode(buffer);
        return this.sanitizeAndRepairText(latinDecoded);
      } catch {
        // Fallback para utf-8
      }
    }

    // 4. Decodificação inicial com UTF-8
    let decoded = '';
    try {
      decoded = new TextDecoder('utf-8').decode(buffer);
    } catch {
      decoded = new TextDecoder('latin1').decode(buffer);
    }

    // 5. Se UTF-8 gerou muitos caracteres de substituição (\uFFFD), tenta latin1
    const replacementCount = (decoded.match(/\uFFFD/g) || []).length;
    if (replacementCount > 3) {
      try {
        const latinAttempt = new TextDecoder('latin1').decode(buffer);
        const latinReplacementCount = (latinAttempt.match(/\uFFFD/g) || []).length;
        if (latinReplacementCount < replacementCount) {
          decoded = latinAttempt;
        }
      } catch {}
    }

    return this.sanitizeAndRepairText(decoded);
  }

  /**
   * Pipeline universal de sanitização e reparo de encoding:
   * Executa a sequência completa de reparos, normalização Unicode NFC e remoção de caracteres invisíveis
   */
  public static sanitizeAndRepairText(text: string): string {
    if (!text || typeof text !== 'string') return '';

    let cleaned = text;

    // 1. Remove caracteres invisíveis/zero-width que possam ter sido injetados (T33)
    cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '');

    // 2. Decodifica entidades HTML
    cleaned = this.decodeHtmlEntities(cleaned);

    // 3. Corrige Mojibake
    cleaned = this.repairMojibake(cleaned);

    // 4. Reconstrói acentos legais específicos (ex: Presidência da República, LEI Nº 13.709)
    cleaned = this.repairCorruptedLegalAccents(cleaned);

    // 5. Normaliza em Unicode NFC (Canonical Composition)
    cleaned = cleaned.normalize('NFC');

    return cleaned;
  }
}
