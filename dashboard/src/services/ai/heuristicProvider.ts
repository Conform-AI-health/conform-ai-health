import { z } from 'zod';
import { CircuitBreaker } from '../../shared/circuitBreaker.js';
import { NORMS_CATALOG } from '../../data/normsCatalog.js';
import { ScrapeResult } from '../scraperService.js';
import { AgentContext, ReconciliationOutput, violationSchema, reconciliationOutputSchema } from '../../shared/reconciliationTypes.js';
import { IAIProvider, AIProviderHealth, AIProviderType } from './aiProvider.interface.js';

export class HeuristicProvider implements IAIProvider {
  public readonly providerId: AIProviderType = 'heuristic';
  public readonly displayName: string = 'Motor Heurístico Deontológico';

  private circuitBreaker = new CircuitBreaker({
    name: 'HeuristicEngine',
    failureThreshold: 10,
    resetTimeoutMs: 5000,
  });

  public getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  public async reconcile(
    scrape: ScrapeResult,
    agentContext?: AgentContext,
    _modelConfig?: any
  ): Promise<ReconciliationOutput> {
    return this.executeHeuristic(scrape, undefined, agentContext);
  }

  public executeHeuristic(
    scrape: ScrapeResult,
    customSummaryHeader?: string,
    agentContext?: AgentContext
  ): ReconciliationOutput {
    const violations: z.infer<typeof violationSchema>[] = [];
    const textLower = scrape.cleanMarkdown.toLowerCase();

    // Normas ativas fornecidas pelo contexto do agente ou catálogo
    const activeNorms =
      agentContext?.activeNorms && agentContext.activeNorms.length > 0
        ? agentContext.activeNorms
        : NORMS_CATALOG;

    // Relação de especialidades para confronto dinâmico
    const medicalSpecialties = [
      'dermatologia',
      'dermatologista',
      'cirurgia plástica',
      'cardiologia',
      'ginecologia',
      'ortopedia',
      'oftalmologia',
      'pediatria',
      'psiquiatria',
    ];

    for (const norm of activeNorms) {
      const keywords = norm.keywords.map((k) => k.toLowerCase());

      // 1. Norma de identificação profissional (CRM / Registro) - T11 e T12
      if (keywords.includes('crm') || keywords.includes('registro')) {
        if (scrape.extractedEntities.crms.length === 0) {
          violations.push({
            normCode: norm.normCode || 'Res. CFM 2.336/23',
            normArticle: norm.article || 'Artigo 1º, § 1º',
            severity: norm.severityDefault || 'GRAVE',
            detectedText: 'Nenhum número de identificação profissional (CRM) identificado no material auditado.',
            correctiveAdvice: norm.correctiveGuidance || 'Informar de forma ostensiva o número de inscrição no Conselho Regional de Medicina (CRM) acompanhado da respectiva UF.',
          });
        } else if (scrape.extractedEntities.states.length === 0) {
          violations.push({
            normCode: norm.normCode || 'Res. CFM 2.336/23',
            normArticle: norm.article || 'Artigo 1º, § 1º',
            severity: 'MEDIA',
            detectedText: `Identificação profissional detectada (${scrape.extractedEntities.crms.join(', ')}), porém sem indicação expressa da Unidade Federativa (UF).`,
            correctiveAdvice: norm.correctiveGuidance || 'Acompanhar a inscrição do CRM com a sigla do estado onde atua o profissional.',
          });
        }
        continue;
      }

      // 2. Norma de qualificação de especialidade (RQE / Especialista) - T11 e T12
      if (keywords.includes('rqe') || keywords.includes('especialista') || keywords.includes('especialidade')) {
        const specialtyKeywordMatch =
          keywords.find((k) => k !== 'rqe' && k !== 'especialista' && k !== 'especialidade' && textLower.includes(k)) ||
          medicalSpecialties.find((spec) => textLower.includes(spec));

        if (specialtyKeywordMatch && scrape.extractedEntities.rqes.length === 0) {
          violations.push({
            normCode: norm.normCode || 'Res. CFM 2.336/23',
            normArticle: norm.article || 'Artigo 1º, § 2º e Artigo 2º',
            severity: norm.severityDefault || 'GRAVE',
            detectedText: `Menção a especialidade médica ("${specialtyKeywordMatch}") sem a concomitante divulgação do respectivo Registro de Qualificação de Especialista (RQE).`,
            correctiveAdvice: norm.correctiveGuidance || 'Apenas anunciar especialidade médica com a indicação expressa do respectivo número de RQE registrado no CRM.',
          });
        }
        continue;
      }

      // 3. Norma de vedação a promessas de resultado, cura ou sensacionalismo
      if (
        keywords.some((k) => ['garantido', '100%', 'cura definitiva', 'promessa', 'resultado', 'infalível'].includes(k))
      ) {
        const matchedPromise = keywords.find((k) => textLower.includes(k));
        if (scrape.extractedEntities.hasGuaranteedResultMention || matchedPromise) {
          violations.push({
            normCode: norm.normCode,
            normArticle: norm.article,
            severity: norm.severityDefault,
            detectedText: `Uso de alegação sensacionalista ou garantia de resultado identificada: "${matchedPromise || 'Expressão de garantia de resultado'}".`,
            correctiveAdvice: norm.correctiveGuidance,
          });
        }
        continue;
      }

      // 4. Norma de imagens comparativas ("Antes e Depois")
      if (keywords.some((k) => ['antes e depois', 'fotos comparativas', 'transformação'].includes(k))) {
        const matchedBeforeAfter = keywords.find((k) => textLower.includes(k));
        if (scrape.extractedEntities.hasBeforeAfterMention || matchedBeforeAfter) {
          violations.push({
            normCode: norm.normCode,
            normArticle: norm.article,
            severity: norm.severityDefault,
            detectedText: `Presença de elementos alusivos a resultados comparativos ou 'antes e depois' identificada: "${matchedBeforeAfter || 'Antes e depois'}".`,
            correctiveAdvice: norm.correctiveGuidance,
          });
        }
        continue;
      }

      // 5. Norma de preços, promoções ou formas de pagamento
      if (keywords.some((k) => ['promoção', 'desconto', 'preço', 'parcelamento', 'sorteio', 'combo'].includes(k))) {
        const matchedPricing = keywords.find((k) => textLower.includes(k));
        if (scrape.extractedEntities.hasPromotionalPricing || matchedPricing) {
          violations.push({
            normCode: norm.normCode,
            normArticle: norm.article,
            severity: norm.severityDefault,
            detectedText: `Divulgação comercial de vantagens financeiras ou preços promocionais: "${matchedPricing || 'Promoção'}".`,
            correctiveAdvice: norm.correctiveGuidance,
          });
        }
        continue;
      }

      // 6. Confronto genérico baseado nas demais palavras-chave cadastradas na norma
      const matchedGeneralKeyword = keywords.find(
        (kw) => kw.length > 3 && textLower.includes(kw)
      );
      if (matchedGeneralKeyword) {
        const hasMitigatingNegation = new RegExp(`não\\s+${matchedGeneralKeyword}|sem\\s+${matchedGeneralKeyword}`, 'i').test(
          scrape.cleanMarkdown
        );
        if (!hasMitigatingNegation) {
          violations.push({
            normCode: norm.normCode,
            normArticle: norm.article,
            severity: norm.severityDefault,
            detectedText: `Trecho condizente com a regra regulamentada: "${matchedGeneralKeyword}".`,
            correctiveAdvice: norm.correctiveGuidance,
          });
        }
      }
    }

    // Deduplicação por artigo
    const uniqueViolations = violations.filter(
      (v, idx, arr) => arr.findIndex((t) => t.normArticle === v.normArticle && t.normCode === v.normCode) === idx
    );

    // Cálculo do Score Ponderado
    let penalty = 0;
    for (const v of uniqueViolations) {
      if (v.severity === 'CRITICA') penalty += 35;
      else if (v.severity === 'GRAVE') penalty += 20;
      else if (v.severity === 'MEDIA') penalty += 10;
      else if (v.severity === 'LEVE') penalty += 5;
    }

    const score = Math.max(0, 100 - penalty);
    let verdict: 'CONFORME' | 'PARCIALMENTE_CONFORME' | 'NAO_CONFORME' = 'CONFORME';
    if (score < 50) verdict = 'NAO_CONFORME';
    else if (score < 90) verdict = 'PARCIALMENTE_CONFORME';

    const header = customSummaryHeader ? `${customSummaryHeader} | ` : '';
    const summary = `${header}Auditoria deontológica automatizada processou ${activeNorms.length} normas regulatórias ativas vinculadas ao agente. Foram identificadas ${uniqueViolations.length} infrações às diretrizes normativas vigentes.`;

    const sourcesUsed = activeNorms.map((n) => `${n.normCode} (${n.article}): ${n.title}`);

    return reconciliationOutputSchema.parse({
      verdict,
      score,
      summary,
      violations: uniqueViolations,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      sourcesUsed,
      aiModelUsed: 'heuristic:regex-heuristic-v1',
      groundingScore: null,
      hallucinationRisk: 'NOT_EVALUATED',
      guardrailsApplied: false,
      hallucinationsInterceptedCount: 0,
    });
  }

  public async testConnection(customPrompt?: string): Promise<AIProviderHealth> {
    const startTime = Date.now();
    return {
      provider: 'heuristic',
      model: 'regex-heuristic-v1',
      status: 'ONLINE',
      latencyMs: Date.now() - startTime,
      response: `Motor Heurístico Deontológico Operacional: Catálogo Normativo Ativo em memória (${customPrompt || 'Pronto'}).`,
      testedAt: new Date().toISOString(),
    };
  }
}
