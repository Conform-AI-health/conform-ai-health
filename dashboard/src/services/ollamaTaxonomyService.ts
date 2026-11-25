import { env } from '../config/env.js';
import { safeHttpPostJson } from '../shared/security.js';
import { resolveOllamaBaseUrl } from './ai/aiUrlResolver.js';
import {
  DeontologicalTaxonomyService,
  TaxonomyInferenceInput,
  TaxonomyInferenceResult,
} from './deontologicalTaxonomyService.js';

export interface OllamaTaxonomyResponse {
  jurisdictionTag: string;
  normTypeTag: string;
  statusTag: 'VIGENTE' | 'REVOGADA';
  macroTema: string;
  thematicTags: string[];
  allTags: string[];
  confidence: number;
  reasoning: string;
  provider: 'ollama' | 'heuristic_fallback';
  modelUsed?: string;
}

export interface OllamaTaxonomyOptions {
  baseUrl?: string;
  modelId?: string;
  timeoutMs?: number;
  temperature?: number;
}

export class OllamaTaxonomyService {
  /**
   * Catálogo de macro-temas de referência (não exaustivo, aberto para novos domínios)
   */
  public static readonly CANONICAL_MACRO_TEMAS = [
    'FORMACAO_E_ESPECIALIDADES',
    'PRATICA_CLINICA_E_PROCEDIMENTOS',
    'PUBLICIDADE_E_PROPAGANDA',
    'SAUDE_DIGITAL_E_TELEMEDICINA',
    'VIGILANCIA_SANITARIA_E_PRODUTOS',
    'SAUDE_SUPLEMENTAR_E_PLANOS',
    'PRIVACIDADE_E_DADOS_SENSIVEIS',
    'ODONTOLOGIA_E_PROCEDIMENTOS',
    'BIOETICA_E_DIREITOS_HUMANOS',
    'TRANSPLANTES_E_DOACAO',
    'PERICIA_MEDICA_E_AUDITORIA',
    'CUIDADOS_PALIATIVOS',
  ];

  /**
   * Prompt de sistema com taxonomia aberta e flexível para guiar o LLM na diversidade de documentos de saúde
   */
  private static buildPrompt(input: TaxonomyInferenceInput): string {
    const normSummary = `
IDENTIFICADOR: ${input.normId}
ÓRGÃO/JURISDIÇÃO: ${input.orgao || 'NÃO ESPECIFICADO'}
TIPO DE ATO: ${input.tipo || 'NÃO ESPECIFICADO'}
EMENTA: ${input.ementa || 'SEM EMENTA'}
CONTEÚDO/EXCERTO: ${(input.content || '').slice(0, 5000)}
STATUS ATUAL: ${input.status || 'VIGENTE'}
TAGS ATUAIS: ${(input.currentTags || []).join(', ')}
`.trim();

    return `
Você é um Auditor e Cientista de Dados Especialista em Taxonomia Deontológica e Regulação em Saúde (CFM, CFO, ANVISA, ANS, LGPD).
Sua função é analisar o documento normativo fornecido e extrair metadados estruturais e tags temáticas específicas em vocabulário aberto e dinâmico, refletindo com fidelidade a diversidade e o objeto real da norma.

MACRO-TEMAS DE REFERÊNCIA (escolha o que melhor se adequar ou defina um macro-tema específico em UPPER_SNAKE_CASE):
- FORMACAO_E_ESPECIALIDADES: Especialidades médicas, títulos, RQE, residência médica, comissões de especialidades (CME).
- PRATICA_CLINICA_E_PROCEDIMENTOS: Prática médica, cirurgias ambulatoriais, anestesiologia, porte cirúrgico, SRPA, UTI móvel, consentimento (TCLE), segurança do paciente.
- PUBLICIDADE_E_PROPAGANDA: Comunicação médica, antes e depois, sensacionalismo, promoções, preços, anúncios, redes sociais.
- SAUDE_DIGITAL_E_TELEMEDICINA: Telemedicina, teleconsulta remota, prontuário eletrônico, receita digital.
- VIGILANCIA_SANITARIA_E_PRODUTOS: Registro na ANVISA, cosméticos, propaganda de medicamentos, insumos de saúde.
- SAUDE_SUPLEMENTAR_E_PLANOS: Operadoras de planos de saúde, rede credenciada, rol de procedimentos da ANS.
- PRIVACIDADE_E_DADOS_SENSIVEIS: LGPD, tratamento de dados sensíveis de saúde, consentimento, política de privacidade.
- ODONTOLOGIA_E_PROCEDIMENTOS: Práticas odontológicas, harmonização orofacial (HOF), CFO/CRO.
- BIOETICA_E_DIREITOS_HUMANOS: Terminalidade da vida, cuidados paliativos, diretivas antecipadas de vontade, reprodução assistida.
- PERICIA_MEDICA_E_AUDITORIA: Perícias judiciais, auditoria médica, emissão de laudos e atestados.

DOCUMENTO PARA ANÁLISE:
${normSummary}

INSTRUÇÕES OBRIGATÓRIAS (VOCABULÁRIO ABERTO E DINÂMICO):
1. "jurisdiction": Jurisdição canônica (CFM, CFO, ANVISA, ANS, LGPD ou órgão regulador equivalente).
2. "normType": Tipo de ato normativo (RESOLUCAO, LEI, RDC, PARECER, PORTARIA, NOTA_TECNICA).
3. "status": "REVOGADA" se o documento contiver revogação explícita; caso contrário "VIGENTE".
4. "macroTema": Macro-tema predominante representativo do tema central em MAIÚSCULAS_COM_UNDERSCORE.
5. "thematicTags": Lista de tags temáticas ABERTAS e expressivas que descrevam os temas, procedimentos, especialidades e conceitos específicos abordados no texto (formato UPPER_SNAKE_CASE sem caracteres especiais).
   - Seja abrangente e preciso: identifique livremente todas as especialidades, procedimentos clínicos, termos técnicos e temas deontológicos presentes no documento.
6. "confidence": Número decimal de 0.0 a 1.0.
7. "reasoning": Breve justificativa jurídica da classificação temática.

Retorne APENAS um JSON válido no formato:
{
  "jurisdiction": "CFM",
  "normType": "RESOLUCAO",
  "status": "VIGENTE",
  "macroTema": "MACRO_TEMA_IDENTIFICADO",
  "thematicTags": ["TAG_TEMATICA_1", "TAG_TEMATICA_2", "TAG_TEMATICA_3"],
  "confidence": 0.95,
  "reasoning": "Texto explicativo..."
}
`;
  }

  /**
   * Infere as tags deontológicas utilizando o Ollama com fallback determinístico
   */
  public static async inferTags(
    input: TaxonomyInferenceInput,
    options?: OllamaTaxonomyOptions
  ): Promise<OllamaTaxonomyResponse> {
    const ollamaUrl = resolveOllamaBaseUrl(options?.baseUrl);
    const model = options?.modelId || env.OLLAMA_MODEL || 'qwen2.5:7b';
    const timeoutMs = options?.timeoutMs || 45000;
    const temperature = options?.temperature ?? 0.1;

    try {
      const prompt = this.buildPrompt(input);

      const response = await safeHttpPostJson(
        `${ollamaUrl}/api/generate`,
        {
          model,
          prompt,
          format: 'json',
          stream: false,
          options: {
            temperature,
          },
        },
        { timeout: timeoutMs }
      );

      let rawResponseText = response.data?.response || '{}';
      if (rawResponseText.includes('```')) {
        rawResponseText = rawResponseText.replace(/```json/gi, '').replace(/```/g, '').trim();
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawResponseText);
      } catch {
        const jsonMatch = rawResponseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('A resposta do modelo Ollama não contém um JSON estruturado válido.');
        }
      }

      // Normalização e sanitização
      const jurisdictionTag = String(parsed.jurisdiction || input.orgao || 'CFM').toUpperCase().trim();
      const normTypeTag = String(parsed.normType || input.tipo || 'RESOLUCAO').toUpperCase().trim();
      const statusTag: 'VIGENTE' | 'REVOGADA' =
        String(parsed.status).toUpperCase() === 'REVOGADA' || String(input.status).toUpperCase() === 'REVOGADA'
          ? 'REVOGADA'
          : 'VIGENTE';

      let macroTema = String(parsed.macroTema || '')
        .toUpperCase()
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^A-Z0-9_]/g, '');

      // Se não houver macro-tema identificado ou for inválido, usa fallback contextual
      if (!macroTema || macroTema.length < 3) {
        macroTema = 'PRATICA_CLINICA_E_PROCEDIMENTOS';
      }

      // Sanitização das thematicTags retornadas pelo LLM
      const rawThematic = Array.isArray(parsed.thematicTags) ? parsed.thematicTags : [];
      const sanitizedThematicSet = new Set<string>();

      for (const t of rawThematic) {
        if (typeof t === 'string') {
          const cleanTag = t
            .toUpperCase()
            .trim()
            .replace(/\s+/g, '_')
            .replace(/[^A-Z0-9_]/g, '');

          // Ignora tags estruturais ou vazias
          if (
            cleanTag.length > 1 &&
            cleanTag !== jurisdictionTag &&
            cleanTag !== normTypeTag &&
            cleanTag !== statusTag &&
            cleanTag !== 'RAG_READY' &&
            cleanTag !== 'NORMAS_OFFICIAL' &&
            cleanTag !== 'VIGENTE' &&
            cleanTag !== 'REVOGADA'
          ) {
            sanitizedThematicSet.add(cleanTag);
          }
        }
      }

      // Preservação de tags existentes do documento
      for (const t of input.currentTags || []) {
        const upper = t.toUpperCase().trim();
        if (upper !== 'VIGENTE' && upper !== 'REVOGADA' && upper.length > 0) {
          sanitizedThematicSet.add(upper);
        }
      }

      const thematicTags = Array.from(sanitizedThematicSet);

      // Constrói allTags unificadas
      const allTagsSet = new Set<string>();
      allTagsSet.add(jurisdictionTag);
      allTagsSet.add(normTypeTag);
      allTagsSet.add(statusTag);

      for (const t of thematicTags) {
        allTagsSet.add(t);
      }

      if (
        input.includeGovernanceTags === true ||
        (input.currentTags || []).includes('RAG_READY') ||
        (input.currentTags || []).includes('NORMAS_OFFICIAL')
      ) {
        allTagsSet.add('RAG_READY');
        allTagsSet.add('NORMAS_OFFICIAL');
      }

      return {
        jurisdictionTag,
        normTypeTag,
        statusTag,
        macroTema,
        thematicTags,
        allTags: Array.from(allTagsSet),
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
        reasoning: parsed.reasoning || 'Classificação semântica realizada com sucesso via Ollama.',
        provider: 'ollama',
        modelUsed: `ollama:${model}`,
      };
    } catch (err: any) {
      // Fallback transparente e determinístico para o serviço léxico
      const fallbackResult: TaxonomyInferenceResult = DeontologicalTaxonomyService.inferTags(input);

      return {
        jurisdictionTag: fallbackResult.jurisdictionTag,
        normTypeTag: fallbackResult.normTypeTag,
        statusTag: fallbackResult.statusTag,
        macroTema: fallbackResult.macroTema,
        thematicTags: fallbackResult.thematicTags,
        allTags: fallbackResult.allTags,
        confidence: 0.8,
        reasoning: `Fallback ativado devido à indisponibilidade do Ollama: ${err.message}`,
        provider: 'heuristic_fallback',
        modelUsed: 'heuristic:deontological-rules',
      };
    }
  }
}
