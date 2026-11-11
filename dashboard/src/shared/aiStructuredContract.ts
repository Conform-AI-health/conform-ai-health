import { z } from 'zod';
import { ReconciliationOutput, violationSchema } from '../services/reconciliationEngine.js';

/**
 * Contrato de Saída Estruturado de Alta Confiabilidade para Auditoria Deontológica em Saúde
 */
export const findingSchema = z.object({
  description: z.string().describe('Descrição clara da não conformidade deontológica'),
  regulation: z.string().describe('Órgão regulador ou marco normativo (ex: CFM, LGPD, ANVISA, ANS)'),
  article: z.string().describe('Artigo e parágrafo específico violado (ex: Art. 1º, § 1º)'),
  evidence: z.string().nullable().describe('Trecho literal extraído do conteúdo auditado ou null quando não houver evidência factual comprovada'),
  source_version: z.string().nullable().optional().describe('Ano ou versão vigente da norma oficial (ex: 2023, 2026), ou null se não determinado'),
  recommendation: z.string().describe('Recomendação executiva prática para adequação regulatória'),
  requires_human_review: z.boolean().default(false).describe('Indica se há ambiguidade e necessidade de chancela de auditor humano'),
});

export const auditMetadataSchema = z.object({
  tokens: z.object({
    prompt: z.number().default(0),
    completion: z.number().default(0),
    total: z.number().default(0),
  }).default({ prompt: 0, completion: 0, total: 0 }),
  latencyMs: z.number().default(0),
  modelUsed: z.string().default('gemini-3.5-flash'),
  groundingScore: z.number().min(0).max(100).nullable().optional(),
  hallucinationRisk: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'NOT_EVALUATED']).default('NOT_EVALUATED'),
  guardrailsApplied: z.boolean().default(false),
  hallucinationsInterceptedCount: z.number().default(0),
  auditedAt: z.string().default(() => new Date().toISOString()),
}).optional();

export const structuredAuditContractSchema = z.object({
  audit_id: z.string().describe('Identificador único da auditoria'),
  risk_level: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).describe('Classificação de risco deontológico'),
  confidence: z.number().min(0).max(1).describe('Grau de confiança fática e normativa (0.00 a 1.00)'),
  verdict: z.enum(['CONFORME', 'PARCIALMENTE_CONFORME', 'NAO_CONFORME', 'INCONCLUSIVO']).optional(),
  summary: z.string().optional().describe('Resumo executivo do laudo'),
  findings: z.array(findingSchema).describe('Rol de achados regulatórios identificados'),
  metadata: auditMetadataSchema,
});

export type Finding = z.infer<typeof findingSchema>;
export type StructuredAuditContract = z.infer<typeof structuredAuditContractSchema>;

export class AIStructuredContractAdapter {
  /**
   * Converte uma saída bruta da IA ou de formato legado para o Contrato Estruturado Estrito
   */
  public static toStructuredContract(
    output: ReconciliationOutput,
    auditId: string = `AUD-${Date.now()}`
  ): StructuredAuditContract {
    // C01: Impedir classificação CONFORME quando a fundamentação não tiver sido avaliada
    let effectiveVerdict = output.verdict;
    const isGroundingEvaluated = output.groundingScore !== null && output.groundingScore !== undefined;

    if (!isGroundingEvaluated && effectiveVerdict === 'CONFORME') {
      effectiveVerdict = 'INCONCLUSIVO';
    }

    // Mapeamento de score / verdict para risk_level
    let risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (effectiveVerdict === 'NAO_CONFORME' || output.score < 50) {
      const hasCritical = output.violations.some((v) => v.severity === 'CRITICA');
      risk_level = hasCritical ? 'CRITICAL' : 'HIGH';
    } else if (effectiveVerdict === 'INCONCLUSIVO' || effectiveVerdict === 'PARCIALMENTE_CONFORME' || output.score < 85) {
      risk_level = 'MEDIUM';
    } else {
      risk_level = 'LOW';
    }

    // Calcula confiança: se grounding for nulo, confiança é 0.50 prudencial (inconclusivo)
    const baseConfidence = isGroundingEvaluated ? (output.groundingScore as number) / 100 : 0.50;
    const confidence = Math.min(1.0, Math.max(0.1, Number(baseConfidence.toFixed(2))));

    const findings: Finding[] = (output.violations || []).map((v) => {
      // Determina regulação
      let regulation = 'CFM';
      if (v.normCode.toUpperCase().includes('LGPD')) regulation = 'LGPD';
      else if (v.normCode.toUpperCase().includes('ANVISA')) regulation = 'ANVISA';
      else if (v.normCode.toUpperCase().includes('ANS')) regulation = 'ANS';

      // C01: Não presumir source_version como 2023. Extrair ou deixar null/UNKNOWN
      let source_version: string | null = null;
      if (regulation === 'LGPD') {
        source_version = '2018';
      } else {
        const fullYearMatch = v.normCode.match(/\b(19\d\d|20\d\d)\b/);
        const slashYearMatch = v.normCode.match(/\/(\d{2,4})\b/);
        if (fullYearMatch) {
          source_version = fullYearMatch[1];
        } else if (slashYearMatch) {
          source_version = slashYearMatch[1].length === 2 ? `20${slashYearMatch[1]}` : slashYearMatch[1];
        }
      }

      // C01: Não gerar evidências genéricas fictícias quando ausentes (preserva null estrito)
      const hasRealEvidence = v.detectedText && v.detectedText.trim().length > 0;
      const evidence = hasRealEvidence ? v.detectedText.trim() : null;

      // Requer revisão humana se for severidade crítica, baixa confiança, sem evidência real ou grounding não avaliado
      const requires_human_review =
        v.severity === 'CRITICA' ||
        confidence < 0.85 ||
        !hasRealEvidence ||
        !isGroundingEvaluated ||
        !v.normArticle ||
        v.normArticle.toLowerCase().includes('geral');

      return {
        description: v.correctiveAdvice ? `${v.normArticle}: Inadequação detectada` : 'Não conformidade deontológica',
        regulation,
        article: v.normArticle || 'Artigo não especificado',
        evidence,
        source_version,
        recommendation: v.correctiveAdvice || 'Adequar a comunicação segundo as normas vigentes.',
        requires_human_review,
      };
    });

    return {
      audit_id: auditId,
      risk_level,
      confidence,
      verdict: effectiveVerdict,
      summary: output.summary,
      findings,
      metadata: {
        tokens: {
          prompt: output.promptTokens ?? 0,
          completion: output.completionTokens ?? 0,
          total: output.totalTokens ?? 0,
        },
        latencyMs: 0,
        modelUsed: output.aiModelUsed ?? 'gemini-3.5-flash',
        groundingScore: output.groundingScore ?? null,
        hallucinationRisk: output.hallucinationRisk ?? 'NOT_EVALUATED',
        guardrailsApplied: output.guardrailsApplied ?? false,
        hallucinationsInterceptedCount: output.hallucinationsInterceptedCount ?? 0,
        auditedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Converte o Contrato Estruturado de volta para o formato de compatibilidade ReconciliationOutput
   */
  public static fromStructuredContract(contract: StructuredAuditContract): ReconciliationOutput {
    let verdict: 'CONFORME' | 'PARCIALMENTE_CONFORME' | 'NAO_CONFORME' | 'INCONCLUSIVO' = 'CONFORME';
    let score = 100;

    if (contract.verdict) {
      verdict = contract.verdict;
    } else if (contract.risk_level === 'CRITICAL' || contract.risk_level === 'HIGH') {
      verdict = 'NAO_CONFORME';
      score = contract.risk_level === 'CRITICAL' ? 30 : 60;
    } else if (contract.risk_level === 'MEDIUM') {
      verdict = contract.confidence < 0.6 ? 'INCONCLUSIVO' : 'PARCIALMENTE_CONFORME';
      score = 75;
    } else {
      verdict = 'CONFORME';
      score = 95;
    }

    const violations = contract.findings.map((f) => ({
      normCode: f.source_version ? `Res. ${f.regulation} (${f.source_version})` : `Res. ${f.regulation}`,
      normArticle: f.article,
      severity: (contract.risk_level === 'CRITICAL' ? 'CRITICA' : 'MEDIA') as any,
      detectedText: f.evidence || '',
      correctiveAdvice: f.recommendation,
    }));

    return {
      verdict,
      score,
      summary: contract.summary || `Auditoria estruturada finalizada com classificação de risco ${contract.risk_level} e confiança ${(contract.confidence * 100).toFixed(0)}%.`,
      violations,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      sourcesUsed: Array.from(new Set(contract.findings.map((f) => `${f.regulation} - ${f.article}`))),
      aiModelUsed: contract.metadata?.modelUsed || 'gemini-structured-contract',
      groundingScore:
        contract.metadata?.groundingScore ??
        (contract.confidence > 0 ? Math.round(contract.confidence * 100) : null),
      hallucinationRisk:
        contract.metadata?.hallucinationRisk ??
        (contract.confidence >= 0.85 ? 'LOW' : contract.confidence >= 0.6 ? 'MEDIUM' : 'NOT_EVALUATED'),
      guardrailsApplied: contract.findings.some((f) => f.requires_human_review),
      hallucinationsInterceptedCount: contract.metadata?.hallucinationsInterceptedCount ?? 0,
    };
  }
}
