import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { NormChunk } from '../data/normsCatalog.js';
import { ScrapeResult } from '../services/scraperService.js';
import { ReconciliationOutput, violationSchema } from '../services/reconciliationEngine.js';

export type HallucinationType =
  | 'UNGROUNDED_NORM'
  | 'REVOKED_NORM'
  | 'FABRICATED_EVIDENCE'
  | 'INCONSISTENT_VERDICT'
  | 'PROMPT_INJECTION_ATTEMPT';

export interface HallucinationIncident {
  type: HallucinationType;
  reason: string;
  originalViolation?: any;
  actionTaken: 'EXPURGED' | 'SANITIZED' | 'RECALCULATED' | 'BLOCKED';
}

export interface GuardrailsReport {
  groundingScore: number; // 0 a 100
  hallucinationRisk: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  interceptedIncidents: HallucinationIncident[];
  passedChecks: string[];
  sanitizedOutput: ReconciliationOutput;
}

export class AIGuardrails {
  /**
   * Padrões maliciosos ou de tentativa de quebra de diretrizes (Prompt Injection)
   */
  private static readonly INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
    /system\s*:\s*you\s+are\s+now/i,
    /bypass\s+(all\s+)?safety\s+guidelines/i,
    /desconsidere\s+as\s+instruções\s+anteriores/i,
    /assuma\s+o\s+papel\s+de/i,
    /você\s+agora\s+é\s+livre/i,
    /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  ];

  /**
   * Pre-Execution: Sanitização de inputs para mitigar injeção de prompt e delimitadores maliciosos
   */
  public static sanitizeInputPrompt(text: string): {
    sanitized: string;
    injectionDetected: boolean;
    flags: string[];
  } {
    if (!text || typeof text !== 'string') {
      return { sanitized: '', injectionDetected: false, flags: [] };
    }

    const flags: string[] = [];
    let sanitized = text;

    for (const pattern of this.INJECTION_PATTERNS) {
      if (pattern.test(sanitized)) {
        flags.push(`Padrão suspeito detectado: ${pattern.source}`);
        sanitized = sanitized.replace(pattern, '[CONTEÚDO_NEUTRALIZADO_PELO_GUARDRAILS]');
      }
    }

    // Remove caracteres de controle ASCII que causam jailbreak de tokenizers
    sanitized = sanitized.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

    return {
      sanitized,
      injectionDetected: flags.length > 0,
      flags,
    };
  }

  /**
   * Pre-Execution: Gera as diretrizes rigorosas de Ancoragem (Grounding) e Anti-Alucinação para injeção nos prompts
   */
  public static buildGroundingPromptInstructions(activeNorms: NormChunk[]): string {
    const authorizedNormCodes = Array.from(new Set(activeNorms.map((n) => n.normCode))).join(', ');

    return `
====================== GUARDRAILS ANTI-ALUCINAÇÃO & GROUNDING MANDATÓRIO ======================
1. REGRA ABSOLUTA DE ANCORAGEM NORMATIVA (ZERO INVENTED NORMS):
   Você está terminantemente PROIBIDO de citar qualquer lei, código, portaria ou resolução que NÃO conste no rol autorizado de NORMAS VINCULADAS (${authorizedNormCodes || 'Catálogo Ativo'}).
   NÃO invente números de artigos, incisos, códigos de normas ou leis fictícias.

2. REGRA DE VIGÊNCIA (ZERO REVOKED NORMS):
   Normas e resoluções revogadas (ex: Resolução CFM nº 1.974/2011) estão EXTINTAS do mundo jurídico.
   É PROIBIDO imputar infração deontológica com base em normas revogadas.

3. REGRA DE FIDELIDADE FÁTICA (ZERO FABRICATED EVIDENCE):
   No campo 'detectedText', você DEVE fornecer trecho literal ou paráfrase fidedigna comprovadamente presente no 'CONTEÚDO AUDITADO'.
   JAMAIS crie acusações baseadas em condutas inexistentes ou suposições.

4. REGRA DE IN DUBIO PRO REO (CONFORMIDADE POR PADRÃO):
   Se o material auditado não violar explicitamente nenhum artigo das normas fornecidas, você DEVE retornar verdict: "CONFORME", score: 100 e lista de violations vazia [].
==============================================================================================
`;
  }

  /**
   * Post-Execution: Validação de Ancoragem Normativa Estrita (AI-03)
   * Confere se a norma e artigo citados pela IA realmente existem no catálogo ativo,
   * checando código canônico, vigência e situação de revogação sem correspondências parciais fracas.
   */
  public static verifyNormativeGrounding(
    normCode: string,
    normArticle: string,
    activeNorms: NormChunk[]
  ): { isGrounded: boolean; isRevoked: boolean; matchedNorm?: NormChunk; reason?: string } {
    if (!normCode || normCode.trim().length === 0) {
      return { isGrounded: false, isRevoked: false, reason: 'Código da norma não fornecido.' };
    }

    const cleanCode = normCode.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 1. Verificação explícita de normas revogadas conhecidas (ex: Res. CFM 1.974/2011)
    if (
      cleanCode.includes('1974') ||
      normCode.toLowerCase().includes('revogad') ||
      normArticle.toLowerCase().includes('revogad')
    ) {
      return {
        isGrounded: false,
        isRevoked: true,
        reason: `A norma citada "${normCode}" está formalmente revogada e extinta do ordenamento deontológico.`,
      };
    }

    // 2. Busca estrita nas normas ativas autorizadas
    for (const norm of activeNorms) {
      const targetCodeClean = norm.normCode.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normIdClean = norm.id.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Correspondência exata de código ou ID canônico
      if (cleanCode === targetCodeClean || cleanCode === normIdClean) {
        return { isGrounded: true, isRevoked: false, matchedNorm: norm };
      }

      // Correspondência precisa com a resolução (ex: 'cfm2336' ou '23362023')
      if (
        (cleanCode.includes('2336') && targetCodeClean.includes('2336')) ||
        (cleanCode.includes('2217') && targetCodeClean.includes('2217')) ||
        (cleanCode.includes('13709') && targetCodeClean.includes('13709')) ||
        (cleanCode.includes('lgpd') && targetCodeClean.includes('lgpd'))
      ) {
        return { isGrounded: true, isRevoked: false, matchedNorm: norm };
      }
    }

    return {
      isGrounded: false,
      isRevoked: false,
      reason: `A norma "${normCode}" não foi validada contra o repositório oficial de normas vigentes.`,
    };
  }

  /**
   * Post-Execution: Verificação de Fidelidade Fática Rigorosa (AI-04)
   * Garante que a evidência textual é real, eliminando regras genéricas que aprovam sem comprovação.
   */
  public static verifyFactuality(
    evidenceText: string,
    scrapedMarkdown: string,
    extractedEntities?: any
  ): { isGrounded: boolean; matchRatio: number; reason?: string } {
    if (!evidenceText || evidenceText.trim().length === 0) {
      return { isGrounded: false, matchRatio: 0, reason: 'Evidência textual vazia.' };
    }

    const cleanMarkdown = (scrapedMarkdown || '').trim();

    // Detecção de falha de extração ou documento vazio
    if (cleanMarkdown.length < 50) {
      return {
        isGrounded: false,
        matchRatio: 0,
        reason: 'Conteúdo do documento auditado insuficiente ou não extraído.',
      };
    }

    const cleanEvidence = evidenceText.toLowerCase().trim();
    const cleanScraped = cleanMarkdown.toLowerCase();

    // 1. Validação estrita de alegações de ausência (somente com confirmação explícita de entidades)
    const absenceKeywords = [
      'ausência',
      'ausente',
      'nenhum',
      'nenhuma',
      'não identificado',
      'não identificada',
      'não localizado',
      'não localizada',
      'não consta',
      'sem menção',
      'sem indicação',
      'não informado',
      'falta de',
    ];
    const isAbsenceClaim = absenceKeywords.some((w) => cleanEvidence.includes(w));

    if (isAbsenceClaim) {
      if (cleanEvidence.includes('crm')) {
        if (extractedEntities && Array.isArray(extractedEntities.crms) && extractedEntities.crms.length === 0) {
          return { isGrounded: true, matchRatio: 1.0, reason: 'Comprovação fática de ausência de CRM confirmada por varredura.' };
        }
        return { isGrounded: false, matchRatio: 0, reason: 'Alegação de ausência de CRM não pôde ser confirmada pelas entidades extraídas.' };
      }

      if (cleanEvidence.includes('rqe')) {
        if (extractedEntities && Array.isArray(extractedEntities.rqes) && extractedEntities.rqes.length === 0) {
          return { isGrounded: true, matchRatio: 1.0, reason: 'Comprovação fática de ausência de RQE confirmada por varredura.' };
        }
        return { isGrounded: false, matchRatio: 0, reason: 'Alegação de ausência de RQE não confirmada pelas entidades extraídas.' };
      }

      // Alegações de ausência genéricas sem comprovação determinística são rejeitadas
      return {
        isGrounded: false,
        matchRatio: 0,
        reason: 'Alegação de ausência sem validação objetiva por entidades do extrator.',
      };
    }

    // 2. Validação Fática de Infrações Específicas com base em flags do Extrator
    if (
      (cleanEvidence.includes('resultado') || cleanEvidence.includes('garantia') || cleanEvidence.includes('promessa') || cleanEvidence.includes('cura')) &&
      extractedEntities?.hasGuaranteedResultMention
    ) {
      return { isGrounded: true, matchRatio: 1.0, reason: 'Comprovação fática de promessa de resultado garantido confirmada.' };
    }

    if (
      (cleanEvidence.includes('promoção') || cleanEvidence.includes('desconto') || cleanEvidence.includes('comercial') || cleanEvidence.includes('preço') || cleanEvidence.includes('black friday')) &&
      extractedEntities?.hasPromotionalPricing
    ) {
      return { isGrounded: true, matchRatio: 1.0, reason: 'Comprovação fática de apelo comercial ou desconto confirmada.' };
    }

    if (
      (cleanEvidence.includes('antes') || cleanEvidence.includes('depois')) &&
      extractedEntities?.hasBeforeAfterMention
    ) {
      return { isGrounded: true, matchRatio: 1.0, reason: 'Comprovação fática de fotos ou menção a antes/depois confirmada.' };
    }

    // 3. Substring Match Literal (100% fático)
    if (cleanScraped.includes(cleanEvidence)) {
      return { isGrounded: true, matchRatio: 1.0 };
    }

    // 4. Token Overlap com limiar rigoroso (paráfrase auditada)
    const words = cleanEvidence
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    if (words.length === 0) {
      return { isGrounded: false, matchRatio: 0, reason: 'Evidência sem termos substantivos para correspondência.' };
    }

    let matches = 0;
    for (const word of words) {
      if (cleanScraped.includes(word)) {
        matches++;
      }
    }

    const ratio = matches / words.length;

    // Exige correspondência mínima de 65% das palavras relevantes
    if (ratio >= 0.65) {
      return { isGrounded: true, matchRatio: ratio };
    }

    return {
      isGrounded: false,
      matchRatio: ratio,
      reason: `Evidência não encontrada no conteúdo do site (${(ratio * 100).toFixed(0)}% de correspondência; mínimo requerido: 65%).`,
    };
  }

  /**
   * Post-Execution: Pipeline integral de Guardrails Anti-Alucinação
   * Audita, filtra alucinações de normas/fatos e recalcula matematicamente o laudo
   */
  public static async validateAndSanitizeOutput(
    rawOutput: ReconciliationOutput,
    scrape: ScrapeResult,
    activeNorms: NormChunk[],
    correlationId?: string
  ): Promise<{ sanitizedOutput: ReconciliationOutput; guardrailsReport: GuardrailsReport }> {
    const interceptedIncidents: HallucinationIncident[] = [];
    const passedChecks: string[] = [];
    const validViolations: z.infer<typeof violationSchema>[] = [];

    const cleanMarkdown = scrape.cleanMarkdown || '';
    const extractedEntities = scrape.extractedEntities;

    // 1. Auditoria individual de cada violação retornada pelo LLM
    for (const v of rawOutput.violations || []) {
      // 1.1. Checagem Normativa
      const normCheck = this.verifyNormativeGrounding(v.normCode, v.normArticle, activeNorms);

      if (normCheck.isRevoked) {
        interceptedIncidents.push({
          type: 'REVOKED_NORM',
          reason: `A norma citada "${v.normCode}" (${v.normArticle}) está REVOGADA e não possui vigência deontológica.`,
          originalViolation: v,
          actionTaken: 'EXPURGED',
        });
        continue;
      }

      if (!normCheck.isGrounded) {
        interceptedIncidents.push({
          type: 'UNGROUNDED_NORM',
          reason: `A norma citada "${v.normCode}" não consta no rol autorizado para este agente. Alucinação de norma interceptada.`,
          originalViolation: v,
          actionTaken: 'EXPURGED',
        });
        continue;
      }

      // 1.2. Checagem Fática da Evidência
      const factualityCheck = this.verifyFactuality(v.detectedText, cleanMarkdown, extractedEntities);

      if (!factualityCheck.isGrounded) {
        interceptedIncidents.push({
          type: 'FABRICATED_EVIDENCE',
          reason: `Evidência textual forjada pela IA. ${factualityCheck.reason}`,
          originalViolation: v,
          actionTaken: 'EXPURGED',
        });
        continue;
      }

      // Violação 100% ancorada (Normativa + Fática)
      validViolations.push({
        ...v,
        normCode: normCheck.matchedNorm ? normCheck.matchedNorm.normCode : v.normCode,
        normArticle: normCheck.matchedNorm?.article && !v.normArticle ? normCheck.matchedNorm.article : v.normArticle,
      });
    }

    if (interceptedIncidents.length === 0) {
      passedChecks.push('Todas as violações citadas possuem ancoragem normativa e fática comprovada.');
    }

    // 2. Recálculo e Coerência de Score e Veredito (AI-01: Integridade Regulatória)
    let recalculatedScore = rawOutput.score;
    let recalculatedVerdict = rawOutput.verdict;
    let recalculatedSummary = rawOutput.summary;

    // Cenário 2.1: Conteúdo insuficiente ou falha na extração de texto
    if (cleanMarkdown.length < 50) {
      recalculatedScore = 50;
      recalculatedVerdict = 'PARCIALMENTE_CONFORME';
      recalculatedSummary = `[INSUFICIÊNCIA FÁTICA / INCONCLUSIVO] O documento ou página extraída possui apenas ${cleanMarkdown.length} caracteres, impedindo uma auditoria deontológica conclusiva. Requer reextração ou inspeção presencial.`;
      passedChecks.push('Classificação de insuficiência fática aplicada (conteúdo inferior a 50 caracteres).');
    }
    // Cenário 2.2: Todas as violações alegadas pelo LLM eram alucinações de norma ou evidência forjada!
    // REGRA DE OURO (AI-01): Violação descartada NÃO significa conformidade! Ausência de evidência não é prova de conformidade!
    else if (rawOutput.violations.length > 0 && validViolations.length === 0) {
      recalculatedScore = 60; // Nota prudencial rebaixada
      recalculatedVerdict = 'PARCIALMENTE_CONFORME'; // Estado inconclusivo regulatório
      recalculatedSummary = `[INCONCLUSIVO / REVISÃO HUMANA MANDATÓRIA] Todas as ${interceptedIncidents.length} infração(ões) alegadas pela IA foram descartadas pelos Guardrails por falta de ancoragem normativa ou fática. O expurgo de alucinações não constitui conformidade automática e exige auditoria humana.`;
      passedChecks.push('Classificação de inconclusividade deontológica aplicada: bloqueada aprovação automática.');
    } else if (validViolations.length < rawOutput.violations.length) {
      // Cenário 2.3: Parte das violações eram alucinações -> reajusta score proporcionalmente apenas sobre as violações legítimas
      const severityDeductions: Record<string, number> = {
        CRITICA: 30,
        GRAVE: 20,
        MEDIA: 10,
        LEVE: 5,
      };

      let deductions = 0;
      let hasCritica = false;

      for (const v of validViolations) {
        deductions += severityDeductions[v.severity] || 10;
        if (v.severity === 'CRITICA') hasCritica = true;
      }

      recalculatedScore = Math.max(0, 100 - deductions);

      if (recalculatedScore >= 90) {
        recalculatedVerdict = 'CONFORME';
      } else if (recalculatedScore >= 70 && !hasCritica) {
        recalculatedVerdict = 'PARCIALMENTE_CONFORME';
      } else {
        recalculatedVerdict = 'NAO_CONFORME';
      }

      recalculatedSummary = `${rawOutput.summary} [Guardrails Anti-Alucinação: ${interceptedIncidents.length} alucinação(ões) expurgada(s)].`;
    }

    // 3. Cálculo de Índices de Confiabilidade
    const totalClaimed = Math.max(1, rawOutput.violations.length);
    const validCount = validViolations.length;
    const groundingRatio = rawOutput.violations.length === 0 ? 1.0 : validCount / totalClaimed;
    const groundingScore = Math.round(groundingRatio * 100);

    let hallucinationRisk: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' = 'NONE';
    if (interceptedIncidents.length === 0) {
      hallucinationRisk = 'NONE';
    } else if (interceptedIncidents.length === 1 && validCount > 0) {
      hallucinationRisk = 'LOW';
    } else if (interceptedIncidents.length <= 2) {
      hallucinationRisk = 'MEDIUM';
    } else {
      hallucinationRisk = 'HIGH';
    }

    const sanitizedOutput: ReconciliationOutput = {
      ...rawOutput,
      score: recalculatedScore,
      verdict: recalculatedVerdict,
      summary: recalculatedSummary,
      violations: validViolations,
      groundingScore,
      hallucinationRisk,
      guardrailsApplied: interceptedIncidents.length > 0,
      hallucinationsInterceptedCount: interceptedIncidents.length,
    } as any;

    const guardrailsReport: GuardrailsReport = {
      groundingScore,
      hallucinationRisk,
      interceptedIncidents,
      passedChecks,
      sanitizedOutput,
    };

    // 4. Observabilidade & Registro Operacional se houve alucinações interceptadas
    if (interceptedIncidents.length > 0) {
      console.warn(`🛡️ [AIGuardrails] ${interceptedIncidents.length} alucinação(ões) interceptada(s) para ${scrape.url}`);
      try {
        await prisma.systemLog.create({
          data: {
            level: 'WARN',
            module: 'AI_GUARDRAILS',
            correlationId: correlationId || `guardrail-${Date.now()}`,
            message: `🛡️ [AI_GUARDRAILS] Interceptadas ${interceptedIncidents.length} alucinação(ões) na auditoria de ${scrape.url} (Score de Grounding: ${groundingScore}%, Risco: ${hallucinationRisk})`,
            details: JSON.stringify({
              url: scrape.url,
              groundingScore,
              hallucinationRisk,
              incidentsCount: interceptedIncidents.length,
              incidents: interceptedIncidents.map((i) => ({
                type: i.type,
                reason: i.reason,
                normCode: i.originalViolation?.normCode,
                detectedText: i.originalViolation?.detectedText,
                action: i.actionTaken,
              })),
            }),
          },
        });
      } catch (logErr: any) {
        console.warn(`[AIGuardrails] Aviso ao registrar log de guardrails: ${logErr.message}`);
      }
    }

    return {
      sanitizedOutput,
      guardrailsReport,
    };
  }
}
