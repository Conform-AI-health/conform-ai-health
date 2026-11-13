import { z } from 'zod';

/**
 * Schemas Zod e Prompts Unificados para a camada FirecrawlClient (SDK v2).
 *
 * Regras arquiteturais atendidas (ADR-001):
 * - P1/P2: Compatível com o formato `{ type: "json", prompt, schema }` da API v2 do Firecrawl.
 * - PONTO 2 (ADR-001): No fluxo de normas (`POST /api/v1/norms/crawl` e `POST /api/v1/scraped-pages/scrape`),
 *   o `FirecrawlClient` é utilizado EXCLUSIVAMENTE para captura/renderização (`markdown`, `html`, `rawHtml`, `links`),
 *   SEM formato `json`. A classificação e metadados pertencem às camadas determinísticas de
 *   `LegalNormCrawlerService` (`extractLegalMetadata` / `extractLegalReferences`) e, quando ambíguo,
 *   à `AIProviderFactory` (Regras 1 e 5).
 *   O formato `json` do Firecrawl fica RESTRITO à auditoria do website do cliente (`ClientWebsiteExtractionSchema`).
 * - P4: Nenhum roteamento ou descoberta de links por LLM (`linksDocumentosDescobertos` banido).
 * - P5 / PONTO 3: Prompt com tags opcionais validado pelo `@compliance-specialist`.
 */

/**
 * Schema para extração de evidências forenses em websites/ativos de clientes (`ClientScraperService`).
 * Único caso de uso autorizado a invocar `formats: [{ type: 'json', prompt, schema }]` no Firecrawl v2 (ADR-001).
 */
export const ClientWebsiteExtractionSchema = z.object({
  crmsDetectados: z.array(z.string()).optional().default([]),
  rqesDetectados: z.array(z.string()).optional().default([]),
  termosSensacionalistas: z.array(z.string()).optional().default([]),
  antesEDepoisDetectado: z.boolean().optional().default(false),
  coletaDadosLGPDDetectada: z.boolean().optional().default(false),
  politicaPrivacidadePresente: z.boolean().optional().default(false),
  resumoExecutivo: z.string().optional(),
});

export type ClientWebsiteExtraction = z.infer<typeof ClientWebsiteExtractionSchema>;

// Alias mantido para compatibilidade
export const ClientAuditExtractionSchema = ClientWebsiteExtractionSchema;
export type ClientAuditExtraction = ClientWebsiteExtraction;

/**
 * Schema determinístico de saída da classificação de normas (usado internamente e na Camada 2 da AIProviderFactory).
 */
export const AmbiguousNormClassificationSchema = z.object({
  is_norm: z.boolean(),
  norm_type: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional().default(0.5),
  reason: z.string().optional().default('Classificação via AIProviderFactory'),
});

export type AmbiguousNormClassification = z.infer<typeof AmbiguousNormClassificationSchema>;

/**
 * Constrói o prompt de auditoria para extração estruturada (`json`) de websites de clientes
 * com suporte a tags de domínio opcionais (PONTO 2 & PONTO 3 — validado pelo `@compliance-specialist`).
 */
export function buildClientWebsiteExtractionPrompt(optionalTags?: string[]): string {
  const cleanTags = (optionalTags || []).map((t) => t.trim().toUpperCase()).filter(Boolean);
  const tagClause =
    cleanTags.length > 0
      ? `\nFILTRO DE AUDITORIA TEMÁTICA OPCIONAL ATIVO: Observe com atenção especial evidências relativas às tags [${cleanTags.join(', ')}].`
      : '';

  return `Você é um extrator forense especializado em conformidade regulatória, publicidade profissional e proteção de dados (LGPD).${tagClause}
Extraia exclusivamente os fatos observáveis na página auditada:
- crmsDetectados: Lista de registros profissionais CRM/UF encontrados (ex: ["CRM/SP 123456"]).
- rqesDetectados: Lista de registros RQE encontrados (ex: ["RQE 45678"]).
- termosSensacionalistas: Expressões de promessa de resultado, garantia, "100% eficaz", "sem dor", "melhor médico", "desconto" ou "promoção".
- antesEDepoisDetectado: Booleano indicando se há comparativo "antes e depois".
- coletaDadosLGPDDetectada: Booleano indicando se há formulário de captação de dados pessoais, agendamento ou WhatsApp.
- politicaPrivacidadePresente: Booleano indicando se há Termo de Consentimento ou Política de Privacidade explícita.
- resumoExecutivo: Síntese objetiva e estritamente factual do conteúdo da página para auditoria. Não invente dados.`;
}

export const CLIENT_AUDIT_EXTRACT_PROMPT = buildClientWebsiteExtractionPrompt();

/**
 * Constrói o prompt jurídico genérico com tags opcionais para a Camada 2 (casos ambíguos via `AIProviderFactory`).
 * Revisado e validado pelo `@compliance-specialist` (Regra 4.3: proteção contra falso positivo de revogação).
 */
export function buildGenericLegalNormClassificationPrompt(
  title: string,
  textSnippet: string,
  optionalTags?: string[]
): string {
  const cleanTags = (optionalTags || []).map((t) => t.trim().toUpperCase()).filter(Boolean);
  const tagContext =
    cleanTags.length > 0
      ? `\nFiltro de domínio opcional solicitado: [${cleanTags.join(', ')}].`
      : '';

  return `Você é um especialista sênior em Direito Público e Legislação Oficial.
Classifique estritamente em JSON se o documento abaixo é uma NORMA LEGAL OFICIAL (lei ordinária, lei complementar, decreto, portaria, resolução, instrução normativa, medida provisória, emenda constitucional, parecer normativo ou código deontológico) ou se deve ser descartado (página de índice/navegação sem artigos, notícia institucional, cartilha, blog ou página comercial).${tagContext}
REGRA DE VIGÊNCIA (Regra 4.3): Cláusulas finais como "Revogam-se as disposições em contrário" significam que a norma está VIGENTE.
Retorne APENAS um objeto JSON válido no formato:
{"is_norm": boolean, "norm_type": string|null, "confidence": number, "reason": string}

Título: ${title}
Trecho: ${textSnippet.slice(0, 2000)}`;
}
