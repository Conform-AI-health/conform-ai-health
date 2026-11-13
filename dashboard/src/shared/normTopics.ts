/**
 * Classificação temática determinística de normas (sem LLM).
 *
 * Temas aceitos pelo repositório de normas:
 * - LGPD  : privacidade e proteção de dados
 * - CFM   : Conselho Federal/Regional de Medicina e ética médica
 * - ANVISA: vigilância sanitária, medicamentos e produtos para saúde
 * - ANS   : saúde suplementar e planos de saúde
 *
 * Cada tema tem sinais "fortes" (1 ocorrência basta: nome do órgão/lei) e "fracos"
 * (precisam de 2+ ocorrências distintas), evitando falsos positivos com palavras genéricas.
 */

export type NormTopic = 'LGPD' | 'CFM' | 'ANVISA' | 'ANS';

export const ALL_NORM_TOPICS: NormTopic[] = ['LGPD', 'CFM', 'ANVISA', 'ANS'];

export const TOPIC_LABELS: Record<NormTopic, string> = {
  LGPD: 'Privacidade / Proteção de Dados',
  CFM: 'Conselho Federal de Medicina',
  ANVISA: 'Vigilância Sanitária (ANVISA)',
  ANS: 'Saúde Suplementar (ANS)',
};

interface TopicRules {
  strong: RegExp[];
  weak: RegExp[];
}

const TOPIC_RULES: Record<NormTopic, TopicRules> = {
  LGPD: {
    strong: [
      /\blgpd\b/i,
      /lei\s+geral\s+de\s+prote[cç][aã]o\s+de\s+dados/i,
      /\b13\.?709\b/,
      /\banpd\b/i,
      /autoridade\s+nacional\s+de\s+prote[cç][aã]o\s+de\s+dados/i,
      /prote[cç][aã]o\s+de\s+dados\s+pessoais/i,
    ],
    weak: [
      /dados?\s+pessoais?/i,
      /privacidade/i,
      /titular\s+dos?\s+dados/i,
      /tratamento\s+de\s+dados/i,
      /consentimento/i,
      /controlador/i,
      /\boperador\b/i,
    ],
  },
  CFM: {
    strong: [
      /conselho\s+federal\s+de\s+medicina/i,
      /conselho\s+regional\s+de\s+medicina/i,
      /\bcfm\b/i,
      /c[oó]digo\s+de\s+[eé]tica\s+m[eé]dica/i,
      /publicidade\s+m[eé]dica/i,
      /\btelemedicina\b/i,
      /\bato\s+m[eé]dico\b/i,
    ],
    weak: [
      /\bcrm\b/i,
      /\brqe\b/i,
      /prontu[aá]rio/i,
      /\bm[eé]dico\b/i,
      /exerc[ií]cio\s+da\s+medicina/i,
      /rela[cç][aã]o\s+m[eé]dico[-\s]paciente/i,
    ],
  },
  ANVISA: {
    strong: [
      /\banvisa\b/i,
      /ag[eê]ncia\s+nacional\s+de\s+vigil[aâ]ncia\s+sanit[aá]ria/i,
      /vigil[aâ]ncia\s+sanit[aá]ria/i,
      /\brdc\b/i,
      /registro\s+sanit[aá]rio/i,
      /boas\s+pr[aá]ticas\s+de\s+fabrica[cç][aã]o/i,
      /dispositivos?\s+m[eé]dicos?/i,
    ],
    weak: [
      /medicamentos?/i,
      /produtos?\s+para\s+sa[uú]de/i,
      /\bsanit[aá]ri[ao]s?\b/i,
      /software\s+como\s+dispositivo/i,
      /\bsamd\b/i,
      /cosm[eé]ticos?/i,
    ],
  },
  ANS: {
    strong: [
      /ag[eê]ncia\s+nacional\s+de\s+sa[uú]de\s+suplementar/i,
      /sa[uú]de\s+suplementar/i,
      /planos?\s+privados?\s+de\s+assist[eê]ncia\s+[aà]\s+sa[uú]de/i,
      /\b9\.?656\b/,
      /rol\s+de\s+procedimentos/i,
      /\bANS\b/,
    ],
    weak: [
      /planos?\s+de\s+sa[uú]de/i,
      /operadoras?\s+de\s+planos?/i,
      /benefici[aá]rios?/i,
      /cobertura\s+assistencial/i,
      /car[eê]ncia/i,
      /reembolso/i,
    ],
  },
};

export interface TopicMatch {
  topic: NormTopic;
  strongHits: string[];
  weakHits: string[];
}

/**
 * Retorna os temas identificados no texto (título + conteúdo), com as evidências encontradas.
 */
export function classifyNormTopics(title: string, content: string): TopicMatch[] {
  const text = `${title || ''}\n${content || ''}`;
  const matches: TopicMatch[] = [];

  for (const topic of ALL_NORM_TOPICS) {
    const rules = TOPIC_RULES[topic];
    const strongHits = rules.strong.filter((r) => r.test(text)).map((r) => r.source);
    const weakHits = rules.weak.filter((r) => r.test(text)).map((r) => r.source);
    if (strongHits.length >= 1 || weakHits.length >= 2) {
      matches.push({ topic, strongHits, weakHits });
    }
  }
  return matches;
}

/**
 * Normaliza tags solicitadas pelo usuário para os temas suportados.
 * "PRIVACIDADE" e "PRIVACY" são aceitos como sinônimos de LGPD.
 */
export function resolveRequestedTopics(tags?: string[]): NormTopic[] {
  const resolved = new Set<NormTopic>();
  for (const raw of tags || []) {
    const t = raw.trim().toUpperCase();
    if (t === 'PRIVACIDADE' || t === 'PRIVACY') resolved.add('LGPD');
    else if ((ALL_NORM_TOPICS as string[]).includes(t)) resolved.add(t as NormTopic);
  }
  return resolved.size > 0 ? Array.from(resolved) : [...ALL_NORM_TOPICS];
}

/**
 * Valida de forma estrita se o conteúdo possui estrutura de lei/ato normativo e dados dos temas pedidos.
 */
export function validateContentHasTagAndLawData(
  title: string,
  content: string,
  targetTags?: string[],
  url: string = ''
): {
  isValid: boolean;
  hasLawData: boolean;
  hasTagData: boolean;
  matchedTags: string[];
} {
  const cleanTitle = (title || '').trim();
  const cleanBody = (content || '').trim();
  const combinedLower = `${cleanTitle}\n${cleanBody}`.toLowerCase();

  const strongStructuralLawRegex =
    /(\bart\.?\s*[0-9]+[º°o]?|\bartigo\s+[0-9]+|\bpar[aá]grafo\s+[uú]nico\b|§\s*[0-9]+[º°o]?|\bresolve\s*:|\bconsiderando\b|\bementa\s*:|\bcap[ií]tulo\s+[ivxlcdm0-9]+|\binciso\s+[ivxlcdm]+|\bdisp[oõ]e\s+sobre\b|\bfica(?:m)?\s+(?:institu[ií]d|aprovad|estabelecid|proibid|vedad|regulamentad|obrigat[oó]ri))/i;
  const normTitleOrHeaderRegex =
    /\b(resolu[cç][aã]o|parecer|portaria|lei\s+(?:n[º°o]|federal|complementar|ordin[aá]ria|[0-9])|decreto|instru[cç][aã]o\s+normativa|\brdc\b|c[oó]digo\s+de\s+[eé]tica|recomenda[cç][aã]o|nota\s+t[eé]cnica|diretriz|norma\s+regulamentadora)\b/i;

  const hasLawStructure = strongStructuralLawRegex.test(combinedLower);
  const hasNormNaming = normTitleOrHeaderRegex.test(combinedLower) || /\.pdf($|\?|#)/i.test(url);
  const hasMinimumSubstance = cleanBody.length >= 60;
  const hasLawData = hasMinimumSubstance && (hasLawStructure || (hasNormNaming && cleanBody.length >= 120));

  const activeTags = (targetTags || [])
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0 && t !== 'REVOGADO' && t !== 'REVOGADA');

  const matchedTags: string[] = classifyNormTopics(cleanTitle, cleanBody).map((m) => m.topic);

  for (const customTag of activeTags) {
    const isKnown = (ALL_NORM_TOPICS as string[]).includes(customTag) || customTag === 'PRIVACIDADE';
    if (!isKnown && combinedLower.includes(customTag.toLowerCase())) {
      matchedTags.push(customTag);
    }
  }

  const requested = activeTags.map((t) => (t === 'PRIVACIDADE' ? 'LGPD' : t));
  const hasTagData =
    requested.length === 0
      ? matchedTags.length > 0
      : requested.some((reqTag) => matchedTags.includes(reqTag) || combinedLower.includes(reqTag.toLowerCase()));

  return {
    isValid: hasLawData && hasTagData,
    hasLawData,
    hasTagData,
    matchedTags: Array.from(new Set(matchedTags)),
  };
}

/**
 * Verifica de forma estrita se a norma está EXPLICITAMENTE revogada (Regra 4.3).
 * Cláusulas como "Fica revogada a Resolução anterior" ou "Revogam-se as disposições em contrário"
 * NÃO tornam a norma atual revogada.
 */
export function isExplicitlyRevokedNorm(title: string, cleanMarkdown: string): boolean {
  const headerSlice = `${title || ''}\n${(cleanMarkdown || '').slice(0, 700)}`.toLowerCase();

  const sanitizedHeader = headerSlice
    .replace(/fica(?:m)?\s+revogad[ao]s?\b[^.\n]*/gi, '')
    .replace(/revoga(?:-se|m-se)?\b[^.\n]*/gi, '')
    .replace(/revogando(?:-se)?\b[^.\n]*/gi, '')
    .replace(/status\s*:\s*vigente\s*\/?\s*revogad[ao]/gi, '')
    .replace(/situa[cç][aã]o\s*:\s*vigente\s*\/?\s*revogad[ao]/gi, '');

  const explicitRevokedPatterns = [
    /\(\s*revogad[ao]\s+pel[ao]\s+[a-zçãõáéíóú]+\s+/i,
    /\[\s*revogad[ao](?:\s+pel[ao]\s+[^\]]+)?\s*\]/i,
    /\bsitua[cç][aã]o\s*:\s*revogad[ao]\b/i,
    /\bstatus\s*:\s*revogad[ao]\b/i,
    /\bvig[eê]ncia\s*:\s*revogad[ao]\b/i,
    /\bnorma\s+revogada\b/i,
    /\bato\s+revogado\b/i,
    /\bdocumento\s+revogado\b/i,
    /\beste\s+texto\s+foi\s+revogado\b/i,
  ];

  return explicitRevokedPatterns.some((pattern) => pattern.test(sanitizedHeader));
}
