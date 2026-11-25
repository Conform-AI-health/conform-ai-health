/**
 * Serviço de Taxonomia Deontológica e Auto-Tagging Temático Multi-Normativo
 * Atende aos marcos regulatórios de Conselhos Profissionais (CFM, CFO), Agências (ANVISA, ANS) e LGPD.
 *
 * Estrutura Tridimensional:
 *  1. Jurisdição Canônica (CFM, CFO, ANVISA, ANS, LGPD)
 *  2. Macro-Tema Transversal (FORMACAO_E_ESPECIALIDADES, PUBLICIDADE_E_PROPAGANDA, PRATICA_CLINICA_E_PROCEDIMENTOS, etc.)
 *  3. Micro-Tags / Gatilhos Léxicos Específicos (RQE, ESPECIALIDADES_MEDICAS, CIRURGIA_AMBULATORIAL, etc.)
 */

export interface TaxonomyInferenceInput {
  normId: string;
  orgao?: string;
  tipo?: string;
  numero?: string;
  ano?: string;
  ementa?: string | null;
  content?: string | null;
  currentTags?: string[];
  status?: string | null;
  includeGovernanceTags?: boolean;
}

export interface TaxonomyInferenceResult {
  jurisdictionTag: string;
  normTypeTag: string;
  statusTag: 'VIGENTE' | 'REVOGADA';
  macroTema: string;
  thematicTags: string[];
  allTags: string[];
  reasons: string[];
}

interface LexicalRule {
  tag: string;
  macroTema: string;
  patterns: RegExp[];
  weight: number;
  description: string;
  scope?: 'all' | 'primary_only'; // primary_only = analisa apenas ementa, título e metadados
}

export class DeontologicalTaxonomyService {
  /**
   * Catálogo de regras léxicas ponderadas organizadas por eixos temáticos
   */
  private static readonly RULES: LexicalRule[] = [
    // -------------------------------------------------------------
    // Eixo 0: Formação, Residência Médica, RQE e Especialidades (CME / CFM)
    // -------------------------------------------------------------
    {
      tag: 'ESPECIALIDADES_MEDICAS',
      macroTema: 'FORMACAO_E_ESPECIALIDADES',
      patterns: [
        /\bespecialidades?\s+m[eé]dicas?\b/i,
        /\bquadro\s+de\s+especialidades\b/i,
        /\brela[cç][aã]o\s+de\s+especialidades\b/i,
        /\bt[ií]tulo\s+de\s+especialista\b/i,
        /\bqualifica[cç][aã]o\s+de\s+especialista\b/i,
      ],
      weight: 12,
      description: 'Reconhecimento, títulos e quadro de especialidades médicas',
    },
    {
      tag: 'RQE',
      macroTema: 'FORMACAO_E_ESPECIALIDADES',
      patterns: [
        /\brqe\b/i,
        /\bregistro\s+de\s+qualifica[cç][aã]o\s+de\s+especialista\b/i,
      ],
      weight: 11,
      description: 'Registro formal de Qualificação de Especialista nos Conselhos Regionais',
    },
    {
      tag: 'AREAS_DE_ATUACAO',
      macroTema: 'FORMACAO_E_ESPECIALIDADES',
      patterns: [
        /(?:^|[\s,;:(/\[])(?:[aá]reas?)\s+de\s+atua[cç][aã]o(?:$|[\s,;:.)/\]])/i,
        /\bareas?\s+de\s+atua[cç][aã]o\b/i,
      ],
      weight: 10,
      description: 'Áreas de atuação médicas oficialmente reconhecidas',
    },
    {
      tag: 'RESIDENCIA_MEDICA',
      macroTema: 'FORMACAO_E_ESPECIALIDADES',
      patterns: [
        /\bresid[eê]ncia\s+m[eé]dica\b/i,
        /\bcnrm\b/i,
        /\bcomiss[aã]o\s+nacional\s+de\s+resid[eê]ncia\s+m[eé]dica\b/i,
        /\bprograma[s]?\s+de\s+resid[eê]ncia\b/i,
      ],
      weight: 10,
      description: 'Normas sobre programas e comissões de residência médica',
    },
    {
      tag: 'COMISSAO_MISTA_DE_ESPECIALIDADES',
      macroTema: 'FORMACAO_E_ESPECIALIDADES',
      patterns: [
        /\bcomiss[aã]o\s+mista\s+de\s+especialidades\b/i,
        /\bcme\b/i,
      ],
      weight: 10,
      description: 'Comissão Mista de Especialidades (CFM / AMB / CNRM)',
    },

    // -------------------------------------------------------------
    // Eixo 1: Prática Clínica, Procedimentos e Cirurgia Ambulatorial
    // -------------------------------------------------------------
    {
      tag: 'CIRURGIA_AMBULATORIAL',
      macroTema: 'PRATICA_CLINICA_E_PROCEDIMENTOS',
      patterns: [
        /\bcirurgi(?:a|as)\s+(?:em\s+(?:ambiente\s+)?ambulatorial|ambulatoria(?:l|is))\b/i,
        /\bcirurgi(?:a|as)\s+em\s+consult[oó]rio[s]?\b/i,
        /\bcirurgi(?:a|as)\s+fora\s+de\s+ambiente\s+hospitalar\b/i,
        /\bprocedimento[s]?\s+cir[uú]rgico[s]?\s+ambulatoria(?:l|is)\b/i,
        /\bporte\s+cir[uú]rgico\b/i,
        /\bbloco\s+cir[uú]rgico\b/i,
        /\bsala[s]?\s+(?:de\s+cirurgia|cir[uú]rgica[s]?)\b/i,
        /\bunidade[s]?\s+de\s+tipo\s+(?:i|ii|iii|iv)\b/i,
        /\bcentro\s+cir[uú]rgico\s+ambulatorial\b/i,
      ],
      weight: 10,
      description: 'Intervenções cirúrgicas e centros ambulatoriais (contexto estrito)',
    },
    {
      tag: 'ANESTESIOLOGIA',
      macroTema: 'PRATICA_CLINICA_E_PROCEDIMENTOS',
      patterns: [
        /\banestesi(?:a|as|ologia|ologista|sta|co|cos)\b/i,
        /\bseda[cç][aã]o(?:\s+consciente|\s+profunda)?\b/i,
        /\banest[eé]sico[s]?\s+loca(?:l|is)\b/i,
        /\brecupera[cç][aã]o\s+anest[eé]sica\b/i,
      ],
      weight: 10,
      description: 'Regulamentação de procedimentos anestésicos e níveis de sedação',
    },
    {
      tag: 'SRPA',
      macroTema: 'PRATICA_CLINICA_E_PROCEDIMENTOS',
      patterns: [
        /\bsrpa\b/i,
        /\bsala\s+de\s+recupera[cç][aã]o(?:\s+p[oó]s-anest[eé]sica)?\b/i,
        /\brecupera[cç][aã]o\s+p[oó]s-anest[eé]sica\b/i,
      ],
      weight: 8,
      description: 'Requisitos de sala de recuperação pós-anestésica',
    },
    {
      tag: 'UTI_MOVEL',
      macroTema: 'PRATICA_CLINICA_E_PROCEDIMENTOS',
      patterns: [
        /\buti\s+m[oó]vel\b/i,
        /\bambul[aâ]ncia(?:\s+tipo\s+d|\s+de\s+suporte\s+avan[cç]ado)?\b/i,
        /\bremo[cç][aã]o\s+(?:de\s+paciente|inter-hospitalar)\b/i,
        /\bsuporte\s+vital\s+avan[cç]ado\b/i,
      ],
      weight: 8,
      description: 'Obrigatoriedade de suporte intensivo móvel e transferência assistida',
    },
    {
      tag: 'CONSENTIMENTO_INFORMADO',
      macroTema: 'PRATICA_CLINICA_E_PROCEDIMENTOS',
      patterns: [
        /\btermo\s+de\s+consentimento(?:\s+livre\s+e\s+esclarecido)?\b/i,
        /\btcle\b/i,
        /\bconsentimento\s+(?:esclarecido|do\s+paciente|informado)\b/i,
        /\besclarecimento\s+pr[eé]vio\b/i,
      ],
      weight: 9,
      description: 'Dever de obtenção formal de TCLE para atos médicos invasivos',
    },
    {
      tag: 'SEGURANCA_PACIENTE',
      macroTema: 'PRATICA_CLINICA_E_PROCEDIMENTOS',
      patterns: [
        /\bseguran[cç]a\s+do\s+paciente\b/i,
        /\bcontrole\s+de\s+infec[cç][aã]o\b/i,
        /\brisco\s+(?:cir[uú]rgico|sanit[aá]rio|de\s+morte)\b/i,
        /\bassist[eê]ncia\s+(?:imediata|de\s+urg[eê]ncia|emerg[eê]ncia)\b/i,
      ],
      weight: 7,
      description: 'Diretrizes de mitigação de riscos e segurança do paciente',
    },

    // -------------------------------------------------------------
    // Eixo 2: Publicidade e Propaganda Médica
    // -------------------------------------------------------------
    {
      tag: 'PUBLICIDADE_MEDICA',
      macroTema: 'PUBLICIDADE_E_PROPAGANDA',
      patterns: [
        /\bpublicidade\s+m[eé]dica\b/i,
        /\bpropaganda\s+m[eé]dica\b/i,
        /\bpe[cç]a[s]?\s+publicit[aá]ria[s]?\b/i,
        /\bveicula[cç][aã]o\s+publicit[aá]ria\b/i,
        /\ban[uú]ncio[s]?\s+m[eé]dico[s]?\b/i,
        /\bdivulga[cç][aã]o\s+(?:publicit[aá]ria|de\s+atos\s+m[eé]dicos|comercial)\b/i,
      ],
      weight: 10,
      description: 'Normas de divulgação e comunicação de atos médicos em geral',
    },
    {
      tag: 'ANTES_E_DEPOIS',
      macroTema: 'PUBLICIDADE_E_PROPAGANDA',
      patterns: [
        /\bantes\s+e\s+depois\b/i,
        /\bcompara[cç][aã]o\s+de\s+resultados\b/i,
        /\bevolu[cç][aã]o\s+do\s+tratamento\b/i,
        /\bdivulga[cç][aã]o\s+de\s+imagem\s+de\s+paciente\b/i,
      ],
      weight: 10,
      description: 'Condições estritas para uso educativo de imagens de tratamento',
    },
    {
      tag: 'IDENTIFICACAO_CRM_RQE',
      macroTema: 'PUBLICIDADE_E_PROPAGANDA',
      patterns: [
        /\b(?:an[uú]ncio|publicidade|divulga[cç][aã]o|propaganda).{0,60}(?:crm|rqe)\b/i,
        /\b(?:crm|rqe).{0,60}(?:an[uú]ncio|publicidade|divulga[cç][aã]o|propaganda)\b/i,
        /\bidentifica[cç][aã]o\s+(?:profissional\s+)?com\s+(?:crm|rqe)\b/i,
        /\bobrigatoriedade\s+de\s+(?:incluir|divulgar)\s+(?:crm|rqe)\b/i,
      ],
      weight: 9,
      description: 'Obrigatoriedade de identificação profissional em peças publicitárias',
    },
    {
      tag: 'SENSACIONALISMO',
      macroTema: 'PUBLICIDADE_E_PROPAGANDA',
      patterns: [
        /\bsensacionalis(?:mo|ta)\b/i,
        /\bpromessa\s+de\s+resultado[s]?\b/i,
        /\bresultado[s]?\s+garantido[s]?\b/i,
        /\bexclusiv(?:o|a)\s+no\s+brasil\b/i,
        /\binfal[ií]vel\b/i,
        /\bo\s+melhor\b/i,
      ],
      weight: 9,
      description: 'Vedação ao sensacionalismo e promessa de resultados infalíveis',
    },
    {
      tag: 'PRECO_PROMOCAO',
      macroTema: 'PUBLICIDADE_E_PROPAGANDA',
      patterns: [
        /\bpromo[cç][aã]o\b/i,
        /\bdesconto\b/i,
        /\bblack\s+friday\b/i,
        /\bsorteio\b/i,
        /\bcupom\b/i,
        /\bcombo\b/i,
        /\bcart[aã]o\s+fidelidade\b/i,
        /\bconsorcio\b/i,
      ],
      weight: 9,
      description: 'Vedação à mercantilização, promoções de escassez e cupons',
    },
    {
      tag: 'REDES_SOCIAIS',
      macroTema: 'PUBLICIDADE_E_PROPAGANDA',
      patterns: [
        /\bredes\s+sociais\b/i,
        /\binstagram\b/i,
        /\bfacebook\b/i,
        /\bwhatsapp\b/i,
        /\btiktok\b/i,
        /\byoutube\b/i,
        /\binternet\b/i,
      ],
      weight: 7,
      description: 'Regulação de postagens em plataformas digitais e redes sociais',
    },

    // -------------------------------------------------------------
    // Eixo 3: Saúde Digital e Telemedicina
    // -------------------------------------------------------------
    {
      tag: 'TELEMEDICINA',
      macroTema: 'SAUDE_DIGITAL_E_TELEMEDICINA',
      patterns: [
        /\btelemedicina\b/i,
        /\btelessa[uú]de\b/i,
        /\batendimento\s+a\s+dist[aâ]ncia\b/i,
        /\bteleatendimento\b/i,
        /\btelediagn[oó]stico\b/i,
      ],
      weight: 10,
      description: 'Regulamentação geral da prática médica mediada por tecnologias',
    },
    {
      tag: 'TELECONSULTA',
      macroTema: 'SAUDE_DIGITAL_E_TELEMEDICINA',
      patterns: [
        /\bteleconsulta\b/i,
        /\bconsulta\s+(?:on-line|online|virtual|remota)\b/i,
        /\bteleinterconsulta\b/i,
      ],
      weight: 9,
      description: 'Regras e limites de consultas médicas virtuais',
    },
    {
      tag: 'PRONTUARIO_ELETRONICO',
      macroTema: 'SAUDE_DIGITAL_E_TELEMEDICINA',
      patterns: [
        /\bprontu[aá]rio\s+eletr[oó]nico\b/i,
        /\bregistro\s+eletr[oó]nico\s+em\s+sa[uú]de\b/i,
        /\bpep\b/i,
        /\breceita\s+(?:digital|eletr[oó]nica)\b/i,
        /\bassinatura\s+(?:digital|eletr[oó]nica|icp-brasil)\b/i,
      ],
      weight: 9,
      description: 'Sistemas informatizados de registros clínicos e prescrição eletrônica',
    },

    // -------------------------------------------------------------
    // Eixo 4: Vigilância Sanitária e Produtos de Saúde (ANVISA)
    // -------------------------------------------------------------
    {
      tag: 'REGISTRO_ANVISA',
      macroTema: 'VIGILANCIA_SANITARIA_E_PRODUTOS',
      patterns: [
        /\banvisa\b/i,
        /\brdc\b/i,
        /\bregistro\s+sanit[aá]rio\b/i,
        /\bnotifica[cç][aã]o\s+na\s+anvisa\b/i,
        /\bvigil[aâ]ncia\s+sanit[aá]ria\b/i,
      ],
      weight: 10,
      description: 'Conformidade com registros sanitários e normas da ANVISA',
    },
    {
      tag: 'PROPAGANDA_MEDICAMENTOS',
      macroTema: 'VIGILANCIA_SANITARIA_E_PRODUTOS',
      patterns: [
        /\bmedicamento[s]?\s+sob\s+prescri[cç][aã]o\b/i,
        /\brem[eé]dio[s]?\s+tarjado[s]?\b/i,
        /\bpropaganda\s+de\s+medicamento[s]?\b/i,
        /\btoxina\s+botul[ií]nica\b/i,
      ],
      weight: 10,
      description: 'Vedações de propaganda direta ao público para remédios tarjados',
    },
    {
      tag: 'COSMETICOS_CURATIVOS',
      macroTema: 'VIGILANCIA_SANITARIA_E_PRODUTOS',
      patterns: [
        /\bcosm[eé]tico[s]?\b/i,
        /\bdermocosm[eé]tico[s]?\b/i,
        /\bpropriedade[s]?\s+terap[eê]utica[s]?\b/i,
        /\bcura\s+(?:de\s+doen[cç]as|definitiva)\b/i,
      ],
      weight: 8,
      description: 'Proibição de atribuição de propriedades medicamentosas a cosméticos',
    },

    // -------------------------------------------------------------
    // Eixo 5: Saúde Suplementar e Planos de Saúde (ANS)
    // -------------------------------------------------------------
    {
      tag: 'REDE_CREDENCIADA',
      macroTema: 'SAUDE_SUPLEMENTAR_E_PLANOS',
      patterns: [
        /\bans\b/i,
        /\boperadora[s]?\s+de\s+plano[s]?\b/i,
        /\brede\s+credenciada\b/i,
        /\brol\s+de\s+procedimento[s]?\b/i,
        /\bcobertura\s+obrigat[oó]ria\b/i,
        /\bcarencia[s]?\b/i,
      ],
      weight: 10,
      description: 'Transparência de rede conveniada, cobertura e regulação da ANS',
    },

    // -------------------------------------------------------------
    // Eixo 6: Privacidade e Dados Pessoais Sensíveis (LGPD em Saúde)
    // -------------------------------------------------------------
    {
      tag: 'DADOS_SENSIVEIS_SAUDE',
      macroTema: 'PRIVACIDADE_E_DADOS_SENSIVEIS',
      patterns: [
        /\blgpd\b/i,
        /\b13\.?709\b/i,
        /\bdado[s]?\s+(?:pessoais\s+)?sens[ií]ve(?:l|is)\b/i,
        /\bdado[s]?\s+(?:de|sobre\s+a)\s+sa[uú]de\b/i,
        /\bpol[ií]tica\s+de\s+privacidade\b/i,
        /\btermo\s+de\s+privacidade\b/i,
        /(?:lgpd|13\.?709|dados?\s+sens[ií]ve(?:l|is)|privacidade).{0,80}\bartigo\s+11\b|\bartigo\s+11\b.{0,80}(?:lgpd|13\.?709|dados?\s+sens[ií]ve(?:l|is)|privacidade)/i,
      ],
      weight: 10,
      description: 'Governança e proteção especial de dados pessoais sensíveis de saúde',
    },

    // -------------------------------------------------------------
    // Eixo 7: Odontologia e Harmonização Orofacial (CFO)
    // -------------------------------------------------------------
    {
      tag: 'HARMONIZACAO_OROFACIAL',
      macroTema: 'ODONTOLOGIA_E_PROCEDIMENTOS',
      patterns: [
        /\bharmoniza[cç][aã]o\s+orofacial\b/i,
        /\bhof\b/i,
        /\bcfo\b/i,
        /\bcro\b/i,
        /\bcirurgi[aã]o-dentista\b/i,
        /\bodontol[oó]gic(?:o|a)\b/i,
        /\bfios\s+de\s+sustenta[cç][aã]o\b/i,
      ],
      weight: 10,
      description: 'Prática de harmonização orofacial e prerrogativas odontológicas',
    },

    // -------------------------------------------------------------
    // Eixo 8: Especialidades Médicas Específicas (Foco em Título/Ementa)
    // -------------------------------------------------------------
    {
      tag: 'DERMATOLOGIA',
      macroTema: 'ESPECIALIDADE_MEDICA',
      patterns: [/\bdermatolog(?:ia|ista|ico)\b/i, /\btricolog(?:ia|ista)\b/i],
      weight: 7,
      scope: 'primary_only',
      description: 'Normas com foco em dermatologia',
    },
    {
      tag: 'CIRURGIA_PLASTICA',
      macroTema: 'ESPECIALIDADE_MEDICA',
      patterns: [/\bcirurgia\s+pl[aá]stica\b/i, /\bcirurgi[aã]o\s+pl[aá]stico\b/i],
      weight: 8,
      scope: 'primary_only',
      description: 'Normas com foco em cirurgia plástica e estética',
    },
    {
      tag: 'OFTALMOLOGIA',
      macroTema: 'ESPECIALIDADE_MEDICA',
      patterns: [/\boftalmolog(?:ia|ista)\b/i, /\bvis[aã]o\b/i, /\brefra[cç][aã]o\b/i],
      weight: 7,
      scope: 'primary_only',
      description: 'Normas do escopo oftalmológico',
    },
  ];

  /**
   * Infere as tags temáticas, estruturais e de governança para um documento normativo
   */
  public static inferTags(input: TaxonomyInferenceInput): TaxonomyInferenceResult {
    // 1. Separação de escopo: Ementa/Metadados (Primário) vs Conteúdo/Anexos (Secundário)
    const primaryScope = `${input.normId} ${input.orgao || ''} ${input.tipo || ''} ${input.numero || ''} ${input.ano || ''} ${input.ementa || ''}`.trim();
    const secondaryScope = (input.content || '').trim();
    const upperNormId = input.normId.toUpperCase();

    // 2. Jurisdição canônica
    let jurisdictionTag = (input.orgao || '').toUpperCase().trim();
    if (!jurisdictionTag || jurisdictionTag === 'GOV_BR' || jurisdictionTag === 'OUTRO') {
      if (upperNormId.includes('CFM')) jurisdictionTag = 'CFM';
      else if (upperNormId.includes('CFO') || upperNormId.includes('CRO')) jurisdictionTag = 'CFO';
      else if (upperNormId.includes('ANVISA') || upperNormId.includes('RDC')) jurisdictionTag = 'ANVISA';
      else if (upperNormId.includes('ANS')) jurisdictionTag = 'ANS';
      else if (upperNormId.includes('LGPD') || upperNormId.includes('13709')) jurisdictionTag = 'LGPD';
      else jurisdictionTag = 'CFM';
    }

    // 3. Tipo normativo
    let normTypeTag = (input.tipo || '').toUpperCase().trim();
    if (!normTypeTag) {
      if (upperNormId.includes('RES') || upperNormId.includes('RESOLUCAO')) normTypeTag = 'RESOLUCAO';
      else if (upperNormId.includes('LEI')) normTypeTag = 'LEI';
      else if (upperNormId.includes('RDC')) normTypeTag = 'RDC';
      else if (upperNormId.includes('PAR') || upperNormId.includes('PARECER')) normTypeTag = 'PARECER';
      else if (upperNormId.includes('PORT')) normTypeTag = 'PORTARIA';
      else normTypeTag = 'RESOLUCAO';
    }

    // 4. Status de Vigência (depende exclusivamente de input.status e padrões de revogação explícita)
    const isExplicitRevoked =
      String(input.status).toUpperCase() === 'REVOGADA' ||
      /\b(revogada|revoga-se|declarada\s+revogada|status:revogada|tornada\s+sem\s+efeito)\b/i.test(input.ementa || '') ||
      /\b(revoga-se\s+integralmente|fica\s+revogada|est[aá]\s+revogada)\b/i.test(primaryScope);

    const statusTag: 'VIGENTE' | 'REVOGADA' = isExplicitRevoked ? 'REVOGADA' : 'VIGENTE';

    // 5. Detecção de Tags Temáticas e Macro-Tema (Vocabulário Aberto e Dinâmico)
    const detectedTagsSet = new Set<string>();
    const reasons: string[] = [];
    const macroTemaCounts = new Map<string, number>();

    for (const rule of this.RULES) {
      // Teste no escopo primário (Ementa, Título e Metadados) — Peso com bônus de 2.5x
      let matchedInPrimary = false;
      for (const pattern of rule.patterns) {
        if (pattern.test(primaryScope)) {
          detectedTagsSet.add(rule.tag);
          reasons.push(`[${rule.tag}] Ementa/Título acionado por: ${pattern.source}`);
          const weightedScore = rule.weight * 2.5;
          macroTemaCounts.set(rule.macroTema, (macroTemaCounts.get(rule.macroTema) || 0) + weightedScore);
          matchedInPrimary = true;
          break;
        }
      }

      // Se não deu match no primário e a regra permite escopo secundário (conteúdo/anexos)
      if (!matchedInPrimary && rule.scope !== 'primary_only' && secondaryScope.length > 0) {
        for (const pattern of rule.patterns) {
          if (pattern.test(secondaryScope)) {
            detectedTagsSet.add(rule.tag);
            reasons.push(`[${rule.tag}] Corpo integral acionado por: ${pattern.source}`);
            macroTemaCounts.set(rule.macroTema, (macroTemaCounts.get(rule.macroTema) || 0) + rule.weight);
            break;
          }
        }
      }
    }

    // Afinidade institucional de jurisdição para ponderação de desempate
    const jurisdictionAffinity: Record<string, string> = {
      ANS: 'SAUDE_SUPLEMENTAR_E_PLANOS',
      ANVISA: 'VIGILANCIA_SANITARIA_E_PRODUTOS',
      LGPD: 'PRIVACIDADE_E_DADOS_SENSIVEIS',
      CFO: 'ODONTOLOGIA_E_PROCEDIMENTOS',
    };
    const preferredTema = jurisdictionAffinity[jurisdictionTag];
    if (preferredTema && macroTemaCounts.has(preferredTema)) {
      macroTemaCounts.set(preferredTema, (macroTemaCounts.get(preferredTema) || 0) + 5);
    }

    // Identifica o macro-tema predominante
    let macroTema = 'PRATICA_CLINICA_E_PROCEDIMENTOS';
    let highestWeight = 0;
    for (const [tema, weight] of macroTemaCounts.entries()) {
      if (weight > highestWeight) {
        highestWeight = weight;
        macroTema = tema;
      }
    }

    // Se nenhuma regra disparou, define o macro-tema a partir da jurisdição
    if (highestWeight === 0) {
      if (jurisdictionTag === 'ANVISA') macroTema = 'VIGILANCIA_SANITARIA_E_PRODUTOS';
      else if (jurisdictionTag === 'ANS') macroTema = 'SAUDE_SUPLEMENTAR_E_PLANOS';
      else if (jurisdictionTag === 'LGPD') macroTema = 'PRIVACIDADE_E_DADOS_SENSIVEIS';
      else macroTema = 'PRATICA_CLINICA_E_PROCEDIMENTOS';
    }

    // 7. Preservação de tags existentes (sem duplicatas)
    const existingTags = (input.currentTags || []).map((t) => t.toUpperCase().trim());

    // 8. Monta a lista completa unificada
    const allTagsSet = new Set<string>();
    // Estruturais canônicas
    allTagsSet.add(jurisdictionTag);
    allTagsSet.add(normTypeTag);
    allTagsSet.add(statusTag);

    // Temáticas detectadas
    for (const t of detectedTagsSet) {
      allTagsSet.add(t);
    }

    // Temáticas já existentes no registro
    for (const t of existingTags) {
      if (t !== 'VIGENTE' && t !== 'REVOGADA' && t.length > 0) {
        allTagsSet.add(t);
      }
    }

    // Carimbos de governança RAG (incluídos se explicitamente solicitados ou se já existiam)
    const includeGovernance =
      input.includeGovernanceTags === true ||
      existingTags.includes('RAG_READY') ||
      existingTags.includes('NORMAS_OFFICIAL') ||
      existingTags.includes('RAG');

    if (includeGovernance) {
      allTagsSet.add('RAG_READY');
      allTagsSet.add('NORMAS_OFFICIAL');
    }

    const allTags = Array.from(allTagsSet);
    const thematicTags = allTags.filter(
      (t) =>
        t !== jurisdictionTag &&
        t !== normTypeTag &&
        t !== statusTag &&
        t !== 'RAG_READY' &&
        t !== 'NORMAS_OFFICIAL' &&
        t !== 'RAG'
    );

    return {
      jurisdictionTag,
      normTypeTag,
      statusTag,
      macroTema,
      thematicTags,
      allTags,
      reasons,
    };
  }
}
