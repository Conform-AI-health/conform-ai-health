import { z } from 'zod';
import { ReconciliationOutput, violationSchema } from '../services/reconciliationEngine.js';

/**
 * Contrato de Saída Estruturado de Alta Confiabilidade para Auditoria Deontológica em Saúde
 */
export const findingSchema = z.object({
  description: z.string().describe('Descrição clara da não conformidade deontológica'),
  regulation: z.string().describe('Órgão regulador ou marco normativo (ex: CFM, LGPD, ANVISA, ANS)'),
  article: z.string().describe('Artigo e parágrafo específico violado (ex: Art. 1º, § 1º)'),
  evidence: z.string().describe('Trecho literal extraído do conteúdo auditado ou comprovação de ausência'),
  source_version: z.string().default('2023').describe('Ano ou versão vigente da norma oficial (ex: 2023, 2026)'),
  recommendation: z.string().describe('Recomendação executiva prática para adequação regulatória'),
  requires_human_review: z.boolean().default(false).describe('Indica se há ambiguidade e necessidade de chancela de auditor humano'),
});

export const structuredAuditContractSchema = z.object({
  audit_id: z.string().describe('Identificador único da auditoria'),
  risk_level: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).describe('Classificação de risco deontológico'),
  confidence: z.number().min(0).max(1).describe('Grau de confiança fática e normativa (0.00 a 1.00)'),
  summary: z.string().optional().describe('Resumo executivo do laudo'),
  findings: z.array(findingSchema).describe('Rol de achados regulatórios identificados'),
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
    // Mapeamento de score / verdict para risk_level
    let risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (output.verdict === 'NAO_CONFORME' || output.score < 50) {
      const hasCritical = output.violations.some((v) => v.severity === 'CRITICA');
      risk_level = hasCritical ? 'CRITICAL' : 'HIGH';
    } else if (output.verdict === 'PARCIALMENTE_CONFORME' || output.score < 85) {
      risk_level = 'MEDIUM';
    } else {
      risk_level = 'LOW';
    }

    // Calcula confiança a partir do groundingScore e quantidade de violações
    const baseConfidence = (output.groundingScore ?? 100) / 100;
    const confidence = Math.min(1.0, Math.max(0.1, Number(baseConfidence.toFixed(2))));

    const findings: Finding[] = (output.violations || []).map((v) => {
      // Determina regulação
      let regulation = 'CFM';
      if (v.normCode.toUpperCase().includes('LGPD')) regulation = 'LGPD';
      else if (v.normCode.toUpperCase().includes('ANVISA')) regulation = 'ANVISA';
      else if (v.normCode.toUpperCase().includes('ANS')) regulation = 'ANS';

      // Determina versão da norma
      let source_version = '2023';
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

      // Requer revisão humana se for severidade crítica, baixa confiança ou sem artigo explícito
      const requires_human_review =
        v.severity === 'CRITICA' ||
        confidence < 0.85 ||
        !v.normArticle ||
        v.normArticle.toLowerCase().includes('geral');

      return {
        description: v.correctiveAdvice ? `${v.normArticle}: Inadequação detectada` : 'Não conformidade deontológica',
        regulation,
        article: v.normArticle || 'Artigo Geral',
        evidence: v.detectedText || 'Evidência constatada na página auditada',
        source_version,
        recommendation: v.correctiveAdvice || 'Adequar a comunicação segundo as normas vigentes.',
        requires_human_review,
      };
    });

    return {
      audit_id: auditId,
      risk_level,
      confidence,
      summary: output.summary,
      findings,
    };
  }

  /**
   * Converte o Contrato Estruturado de volta para o formato de compatibilidade ReconciliationOutput
   */
  public static fromStructuredContract(contract: StructuredAuditContract): ReconciliationOutput {
    let verdict: 'CONFORME' | 'PARCIALMENTE_CONFORME' | 'NAO_CONFORME' = 'CONFORME';
    let score = 100;

    if (contract.risk_level === 'CRITICAL' || contract.risk_level === 'HIGH') {
      verdict = 'NAO_CONFORME';
      score = contract.risk_level === 'CRITICAL' ? 30 : 60;
    } else if (contract.risk_level === 'MEDIUM') {
      verdict = 'PARCIALMENTE_CONFORME';
      score = 75;
    } else {
      verdict = 'CONFORME';
      score = 95;
    }

    const violations = contract.findings.map((f) => ({
      normCode: `Res. ${f.regulation} (${f.source_version})`,
      normArticle: f.article,
      severity: contract.risk_level === 'CRITICAL' ? 'CRITICA' : 'MEDIA' as any,
      detectedText: f.evidence,
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
      aiModelUsed: 'gemini-structured-contract',
      groundingScore: Math.round(contract.confidence * 100),
      hallucinationRisk: contract.confidence >= 0.9 ? 'NONE' : contract.confidence >= 0.75 ? 'LOW' : 'MEDIUM',
      guardrailsApplied: contract.findings.some((f) => f.requires_human_review),
      hallucinationsInterceptedCount: 0,
    };
  }
}
