import { RuleSeverity } from '@prisma/client';

export interface NormValidityMetadata {
  publishedAt: string;            // Data de publicação oficial
  effectiveDate: string;          // Data de início da vigência legal
  revokedAt?: string | null;      // Data da revogação formal (se aplicável)
  isRevoked: boolean;             // Flag estrita de vigência (false = em vigor; true = revogada)
  officialGazette: string;        // Publicação em Diário Oficial / Fonte governamental
  replacedByNormCode?: string;    // Norma substituta revogadora
}

export interface NormChunk {
  id: string;
  normCode: string;
  source: 'CFM' | 'ANS' | 'ANVISA' | 'LGPD';
  title: string;
  article: string;
  severityDefault: RuleSeverity;
  keywords: string[];
  content: string;
  correctiveGuidance: string;
  validity: NormValidityMetadata;
}

export const NORMS_CATALOG: NormChunk[] = [
  // --- CFM nº 2.336/2023 (Em Vigor Pleno) ---
  {
    id: 'CFM-2336-ART-01',
    normCode: 'Res. CFM 2.336/23',
    source: 'CFM',
    title: 'Identificação Obrigatória do Médico e Registro no CRM',
    article: 'Artigo 1º, § 1º',
    severityDefault: 'CRITICA',
    keywords: ['crm', 'registro', 'uf', 'estado', 'identificação', 'médico'],
    content:
      'Em toda publicidade, comunicação ou anúncio médico, é obrigatória a inclusão clara e visível do nome completo do profissional, número de inscrição no Conselho Regional de Medicina (CRM) e a respectiva Unidade Federativa (UF).',
    correctiveGuidance:
      'Inclua no cabeçalho e no rodapé do website e materiais o nome completo do médico, o número do CRM acompanhado da sigla do estado (Ex: Dr. Fulano de Tal - CRM/SP 123456).',
    validity: {
      publishedAt: '2023-09-13',
      effectiveDate: '2024-03-11',
      revokedAt: null,
      isRevoked: false,
      officialGazette: 'DOU nº 175, Seção 1, p. 195 (13/09/2023)',
    },
  },
  {
    id: 'CFM-2336-ART-02',
    normCode: 'Res. CFM 2.336/23',
    source: 'CFM',
    title: 'Obrigatoriedade do Registro de Qualificação de Especialista (RQE)',
    article: 'Artigo 1º, § 2º e Artigo 2º',
    severityDefault: 'CRITICA',
    keywords: ['especialista', 'especialidade', 'rqe', 'dermatologia', 'cirurgia', 'pediatria'],
    content:
      'O anúncio de qualquer especialidade médica ou área de atuação só é lícito se o médico possuir o competente Registro de Qualificação de Especialista (RQE) devidamente registrado no CRM do estado de atuação.',
    correctiveGuidance:
      'Sempre que divulgar uma especialidade (ex: Dermatologista, Cardiologista), inclua expressamente o número do RQE correspondente (Ex: Dermatologia - RQE nº 98765) ou abstenha-se de anunciar a titulação até a conclusão do registro.',
    validity: {
      publishedAt: '2023-09-13',
      effectiveDate: '2024-03-11',
      revokedAt: null,
      isRevoked: false,
      officialGazette: 'DOU nº 175, Seção 1, p. 195 (13/09/2023)',
    },
  },
  {
    id: 'CFM-2336-ART-03',
    normCode: 'Res. CFM 2.336/23',
    source: 'CFM',
    title: 'Vedação a Promessas de Resultado e Sensacionalismo',
    article: 'Artigo 11, Inciso II e Artigo 14',
    severityDefault: 'CRITICA',
    keywords: ['garantido', '100%', 'cura definitiva', 'o melhor', 'infalível', 'promessa', 'resultado'],
    content:
      'É expressamente vedado ao médico prometer resultados, garantir cura ou êxito terapêutico, utilizar expressões como "o melhor", "resultado 100% garantido", ou adjetivações que induzam o paciente a expectativas infundadas.',
    correctiveGuidance:
      'Remova termos absolutistas e promessas de resultado. Substitua por explicações científicas sobre a eficácia dos procedimentos, enfatizando que os resultados variam de acordo com as particularidades biológicas de cada paciente.',
    validity: {
      publishedAt: '2023-09-13',
      effectiveDate: '2024-03-11',
      revokedAt: null,
      isRevoked: false,
      officialGazette: 'DOU nº 175, Seção 1, p. 195 (13/09/2023)',
    },
  },
  {
    id: 'CFM-2336-ART-04',
    normCode: 'Res. CFM 2.336/23',
    source: 'CFM',
    title: 'Regulamentação de Imagens Comparativas ("Antes e Depois")',
    article: 'Artigo 14, § 1º ao § 4º',
    severityDefault: 'GRAVE',
    keywords: ['antes e depois', 'transformação', 'resultado imediato', 'fotos comparativas'],
    content:
      'O uso de imagens de pacientes ("antes e depois") é permitido exclusivamente com finalidade educativa, demonstrando a evolução clínica e complicações possíveis, sendo vedada a manipulação digital, fotos sensacionalistas ou a insinuação de que o mesmo resultado será obtido por outros pacientes.',
    correctiveGuidance:
      'Assegure que as imagens de casos clínicos venham acompanhadas de texto explicativo sobre as características individuais do caso, fatores que influenciaram a evolução e aviso explícito de que não há garantia de resultados idênticos.',
    validity: {
      publishedAt: '2023-09-13',
      effectiveDate: '2024-03-11',
      revokedAt: null,
      isRevoked: false,
      officialGazette: 'DOU nº 175, Seção 1, p. 195 (13/09/2023)',
    },
  },
  {
    id: 'CFM-2336-ART-05',
    normCode: 'Res. CFM 2.336/23',
    source: 'CFM',
    title: 'Proibição de Mercantilização: Promoções, Descontos e Sorteios',
    article: 'Artigo 9º, Incisos I a V',
    severityDefault: 'GRAVE',
    keywords: ['promoção', 'desconto', 'black friday', 'sorteio', 'consórcio', 'cupom', 'combo'],
    content:
      'É vedada a publicidade de serviços médicos com fins de mercantilização, tais como anúncios de descontos, "black friday", sorteios de procedimentos, consórcios, cupons promocionais ou cartão fidelidade.',
    correctiveGuidance:
      'Retire imediatamente menções a preços com desconto promocional, cupons e sorteios. A divulgação de valores deve ser informativa e compatível com a sobriedade da prática médica.',
    validity: {
      publishedAt: '2023-09-13',
      effectiveDate: '2024-03-11',
      revokedAt: null,
      isRevoked: false,
      officialGazette: 'DOU nº 175, Seção 1, p. 195 (13/09/2023)',
    },
  },

  // --- Resolução CFM nº 1.974/2011 (REVOGADA EXPRESSAMENTE - Histórico) ---
  {
    id: 'CFM-1974-REVOGADA',
    normCode: 'Res. CFM 1.974/11',
    source: 'CFM',
    title: 'Manual de Publicidade Médica Anterior (REVOGADO)',
    article: 'Revogação Integral',
    severityDefault: 'MEDIA',
    keywords: ['revogado', 'revogada', '1974', 'antigo manual'],
    content:
      'Esta norma regulamentava a publicidade médica anterior e foi expressamente revogada pela Resolução CFM nº 2.336/2023 a partir de 11 de março de 2024.',
    correctiveGuidance:
      'Esta norma está revogada e não possui aplicabilidade jurídica para imputações deontológicas.',
    validity: {
      publishedAt: '2011-08-19',
      effectiveDate: '2012-02-15',
      revokedAt: '2024-03-11',
      isRevoked: true,
      officialGazette: 'DOU nº 160, Seção 1 (19/08/2011)',
      replacedByNormCode: 'Res. CFM 2.336/23',
    },
  },

  // --- LGPD em Saúde (Lei nº 13.709/2018) ---
  {
    id: 'LGPD-SAUDE-ART-11',
    normCode: 'LGPD Art. 11',
    source: 'LGPD',
    title: 'Tratamento de Dados Pessoais Sensíveis de Saúde',
    article: 'Artigo 11 e Artigo 14',
    severityDefault: 'CRITICA',
    keywords: ['privacidade', 'dados de saúde', 'prontuário', 'consentimento', 'lgpd', 'agendamento online'],
    content:
      'O tratamento de dados pessoais sensíveis relativos à saúde exige consentimento específico e destacado do titular ou enquadramento em hipóteses legais estritas (tutela da saúde ou cumprimento de obrigação legal), sendo proibida a comercialização.',
    correctiveGuidance:
      'Inclua política de privacidade visível, termo de consentimento para coleta de dados de agendamento online e garanta criptografia e sigilo absoluto das informações clínicas enviadas.',
    validity: {
      publishedAt: '2018-08-15',
      effectiveDate: '2020-09-18',
      revokedAt: null,
      isRevoked: false,
      officialGazette: 'DOU Seção 1, p. 1 (15/08/2018)',
    },
  },

  // --- ANS (Agência Nacional de Saúde Suplementar) ---
  {
    id: 'ANS-RN-509-395',
    normCode: 'ANS RN 509/2022',
    source: 'ANS',
    title: 'Clareza na Divulgação de Planos e Rede Credenciada',
    article: 'RN nº 509/2022 e RN nº 395/2016',
    severityDefault: 'MEDIA',
    keywords: ['plano de saúde', 'convênio', 'rede credenciada', 'cobertura', 'carência'],
    content:
      'A divulgação de cobertura de operadoras de planos de saúde deve ser transparente quanto às segmentações atendidas (ambulatorial, hospitalar), evitando induzir o usuário a acreditar em atendimento não contemplado pelo contrato.',
    correctiveGuidance:
      'Especifique claramente quais modalidades e planos de saúde de cada operadora são aceitos na clínica e disponibilize canal de verificação ágil.',
    validity: {
      publishedAt: '2022-03-30',
      effectiveDate: '2022-04-01',
      revokedAt: null,
      isRevoked: false,
      officialGazette: 'DOU Seção 1 (31/03/2022)',
    },
  },

  // --- ANVISA (Agência Nacional de Vigilância Sanitária) ---
  {
    id: 'ANVISA-RDC-727',
    normCode: 'ANVISA RDC 727/22',
    source: 'ANVISA',
    title: 'Proibição de Propaganda de Medicamentos Sob Prescrição ao Público Leigo',
    article: 'RDC nº 727/2022 e Lei 6.360/76',
    severityDefault: 'CRITICA',
    keywords: ['remédio tarjado', 'medicamento sob prescrição', 'toxina botulínica', 'propaganda direta'],
    content:
      'É terminantemente proibida a realização de propaganda comercial direta ao público leigo de medicamentos que exijam prescrição médica (tarja vermelha ou preta), incluindo substâncias como toxina botulínica comercializada como produto final.',
    correctiveGuidance:
      'Substitua a menção comercial a marcas de fármacos e substâncias sob prescrição por descrições gerais do procedimento médico correspondente.',
    validity: {
      publishedAt: '2022-07-06',
      effectiveDate: '2022-08-01',
      revokedAt: null,
      isRevoked: false,
      officialGazette: 'DOU nº 127, Seção 1 (07/07/2022)',
    },
  },

  // --- CFM nº 1.974/2011 (Revogada expressamente pela Resolução CFM 2.336/2023 - C05) ---
  {
    id: 'CFM-1974-HISTORICO',
    normCode: 'Res. CFM 1.974/11',
    source: 'CFM',
    title: 'Critérios Anteriores de Publicidade Médica',
    article: 'Disposições Gerais Anteriores',
    severityDefault: 'LEVE',
    keywords: ['publicidade antiga', '1974', 'cfm anterior'],
    content:
      'Norma revogada que regia a publicidade médica anteriormente. Substituída e revogada pela Resolução CFM nº 2.336/2023.',
    correctiveGuidance:
      'Aplicar exclusivamente as diretrizes vigentes estabelecidas pela Resolução CFM nº 2.336/2023.',
    validity: {
      publishedAt: '2011-08-19',
      effectiveDate: '2012-02-15',
      revokedAt: '2024-03-11',
      isRevoked: true,
      officialGazette: 'DOU Seção 1 (19/08/2011)',
      replacedByNormCode: 'Res. CFM 2.336/23',
    },
  },
];
