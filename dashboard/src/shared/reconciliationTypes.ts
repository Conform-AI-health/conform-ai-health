import { z } from 'zod';
import { RuleSeverity, Verdict } from '@prisma/client';
import { NormChunk } from '../data/normsCatalog.js';
import { ResolvedNorm } from '../services/normsResolver.js';

export const violationSchema = z.object({
  normArticle: z.string().describe('Artigo e parágrafo específico violado'),
  normCode: z.string().describe('Código da norma (ex: Res. CFM 2.336/23, LGPD Art. 11)'),
  severity: z.enum(['LEVE', 'MEDIA', 'GRAVE', 'CRITICA']).describe('Nível de severidade da infração deontológica'),
  detectedText: z.string().describe('Trecho exato ou evidência detectada na página'),
  correctiveAdvice: z.string().describe('Recomendação prática e amigável para adequação regulatória'),
});

export const reconciliationOutputSchema = z.object({
  verdict: z.enum(['CONFORME', 'PARCIALMENTE_CONFORME', 'NAO_CONFORME', 'INCONCLUSIVO']).describe('Veredito semáforo final'),
  score: z.number().min(0).max(100).describe('Pontuação de risco ou conformidade de 0 a 100'),
  summary: z.string().describe('Síntese diagnóstica da auditoria deontológica'),
  violations: z.array(violationSchema).describe('Lista de violações normativas identificadas'),
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
}
