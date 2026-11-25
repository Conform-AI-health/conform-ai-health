import { z } from 'zod';
import { RuleSeverity, Verdict } from '@prisma/client';
import { NormChunk } from '../data/normsCatalog.js';
import { NormRetrievalDiagnostics, ResolvedNorm } from '../services/normsResolver.js';

/**
 * Normaliza variações linguísticas e sinônimos gerados por LLMs para o enum oficial RuleSeverity
 */
export function normalizeSeverity(val: unknown): 'LEVE' | 'MEDIA' | 'GRAVE' | 'CRITICA' {
  if (typeof val !== 'string') return 'MEDIA';
  const clean = val
    .toUpperCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  switch (clean) {
    case 'LEVE':
    case 'LOW':
    case 'BAIXA':
    case 'BAIXO':
    case 'INFORMATIVA':
    case 'MENOR':
      return 'LEVE';
    case 'MEDIA':
    case 'MEDIUM':
    case 'MODERADA':
    case 'MODERADO':
      return 'MEDIA';
    case 'GRAVE':
    case 'HIGH':
    case 'ALTA':
    case 'ALTO':
    case 'SEVERA':
    case 'SEVERO':
      return 'GRAVE';
    case 'CRITICA':
    case 'CRITICAL':
    case 'GRAVISSIMA':
    case 'GRAVISSIMO':
    case 'URGENTE':
    case 'FATAL':
      return 'CRITICA';
    default:
      return 'MEDIA';
  }
}

/**
 * Normaliza variações linguísticas do veredito semáforo gerado por LLMs
 */
export function normalizeVerdict(val: unknown): 'CONFORME' | 'PARCIALMENTE_CONFORME' | 'NAO_CONFORME' | 'INCONCLUSIVO' {
  if (typeof val !== 'string') return 'INCONCLUSIVO';
  const clean = val
    .toUpperCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z]/g, '_');

  if (clean.includes('PARCIAL') || clean === 'PARCIALMENTE' || clean === 'PARCIALMENTE_CONFORME') {
    return 'PARCIALMENTE_CONFORME';
  }
  if (
    clean.includes('NAO_CONFORME') ||
    clean.includes('NON_COMPLIANT') ||
    clean === 'IRREGULAR' ||
    clean === 'VIOLACAO' ||
    clean === 'NAO'
  ) {
    return 'NAO_CONFORME';
  }
  if (
    clean === 'CONFORME' ||
    clean === 'REGULAR' ||
    clean === 'COMPLIANT' ||
    clean === 'APROVADO' ||
    clean === 'ADEQUADO'
  ) {
    return 'CONFORME';
  }
  return 'INCONCLUSIVO';
}

export const violationSchema = z.object({
  normArticle: z.string().describe('Artigo e parágrafo específico violado'),
  normCode: z.string().describe('Código da norma (ex: Res. CFM 2.336/23, LGPD Art. 11)'),
  severity: z
    .preprocess((val) => normalizeSeverity(val), z.enum(['LEVE', 'MEDIA', 'GRAVE', 'CRITICA']))
    .describe('Nível de severidade da infração deontológica'),
  detectedText: z.string().describe('Trecho exato ou evidência detectada na página'),
  correctiveAdvice: z.string().describe('Recomendação prática e amigável para adequação regulatória'),
});

export const reconciliationOutputSchema = z.object({
  verdict: z
    .preprocess(
      (val) => normalizeVerdict(val),
      z.enum(['CONFORME', 'PARCIALMENTE_CONFORME', 'NAO_CONFORME', 'INCONCLUSIVO'])
    )
    .describe('Veredito semáforo final'),
  score: z
    .preprocess((val) => {
      const num = typeof val === 'number' ? val : parseFloat(String(val));
      return isNaN(num) ? 50 : Math.max(0, Math.min(100, Math.round(num)));
    }, z.number().min(0).max(100))
    .describe('Pontuação de risco ou conformidade de 0 a 100'),
  summary: z
    .preprocess((val) => (typeof val === 'string' ? val : String(val ?? '')), z.string())
    .describe('Síntese diagnóstica da auditoria deontológica'),
  violations: z
    .preprocess((val) => (Array.isArray(val) ? val : []), z.array(violationSchema))
    .describe('Lista de violações normativas identificadas'),
  promptTokens: z.number().default(0),
  completionTokens: z.number().default(0),
  totalTokens: z.number().default(0),
  sourcesUsed: z.array(z.string()).default([]),
  aiModelUsed: z.string().default('gemini-3.5-flash'),
  groundingScore: z.number().min(0).max(100).nullable().optional().describe('Score de ancoragem fática e normativa (0-100), ou null se não avaliado'),
  hallucinationRisk: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'NOT_EVALUATED']).default('NOT_EVALUATED').describe('Nível de risco de alucinação deontológica'),
  guardrailsApplied: z.boolean().default(false).describe('Indica se guardrails interceptaram alucinações'),
  hallucinationsInterceptedCount: z.number().default(0).describe('Quantidade de alucinações expurgadas'),
});

export type ReconciliationOutput = z.infer<typeof reconciliationOutputSchema>;

export interface AgentContext {
  id?: string;
  name: string;
  code?: string | null;
  description?: string | null;
  skill?: string;
  regulatoryFramework?: string | null;
  systemPrompt: string;
  targetNorms: string[];
  tags?: string[];
  activeNorms: NormChunk[];
  resolvedDbNorms?: ResolvedNorm[];
  retrievalStatus?: string;
  retrievalSource?: string;
  retrievalCandidatesCount?: number;
  retrievalDiagnostics?: NormRetrievalDiagnostics;
}
