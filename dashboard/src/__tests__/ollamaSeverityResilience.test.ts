import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  reconciliationOutputSchema,
  normalizeSeverity,
  normalizeVerdict,
} from '../shared/reconciliationTypes.js';
import { OllamaProvider } from '../services/ai/ollamaProvider.js';
import * as security from '../shared/security.js';

describe('Resiliência de Enums e Structured Outputs — Ollama Severity Resilience', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalizeSeverity', () => {
    it('deve converter sinônimos como ALTA, ALTO, HIGH e SEVERA para GRAVE', () => {
      expect(normalizeSeverity('ALTA')).toBe('GRAVE');
      expect(normalizeSeverity('alta')).toBe('GRAVE');
      expect(normalizeSeverity('ALTO')).toBe('GRAVE');
      expect(normalizeSeverity('HIGH')).toBe('GRAVE');
      expect(normalizeSeverity('SEVERA')).toBe('GRAVE');
    });

    it('deve converter sinônimos como BAIXA, BAIXO, LOW para LEVE', () => {
      expect(normalizeSeverity('BAIXA')).toBe('LEVE');
      expect(normalizeSeverity('baixo')).toBe('LEVE');
      expect(normalizeSeverity('LOW')).toBe('LEVE');
      expect(normalizeSeverity('INFORMATIVA')).toBe('LEVE');
    });

    it('deve converter variações acentuadas como MÉDIA e MODERADA para MEDIA', () => {
      expect(normalizeSeverity('MÉDIA')).toBe('MEDIA');
      expect(normalizeSeverity('média')).toBe('MEDIA');
      expect(normalizeSeverity('MODERADA')).toBe('MEDIA');
      expect(normalizeSeverity('MODERADO')).toBe('MEDIA');
      expect(normalizeSeverity('MEDIUM')).toBe('MEDIA');
    });

    it('deve converter variações acentuadas como CRÍTICA e GRAVÍSSIMA para CRITICA', () => {
      expect(normalizeSeverity('CRÍTICA')).toBe('CRITICA');
      expect(normalizeSeverity('crítica')).toBe('CRITICA');
      expect(normalizeSeverity('CRITICAL')).toBe('CRITICA');
      expect(normalizeSeverity('GRAVISSIMA')).toBe('CRITICA');
    });

    it('deve usar fallback seguro MEDIA para termos desconhecidos ou inválidos', () => {
      expect(normalizeSeverity('DESCONHECIDO')).toBe('MEDIA');
      expect(normalizeSeverity(null)).toBe('MEDIA');
      expect(normalizeSeverity(undefined)).toBe('MEDIA');
    });
  });

  describe('normalizeVerdict', () => {
    it('deve normalizar variações de não conformidade para NAO_CONFORME', () => {
      expect(normalizeVerdict('NAO CONFORME')).toBe('NAO_CONFORME');
      expect(normalizeVerdict('NÃO_CONFORME')).toBe('NAO_CONFORME');
      expect(normalizeVerdict('NON_COMPLIANT')).toBe('NAO_CONFORME');
    });

    it('deve normalizar variações parciais para PARCIALMENTE_CONFORME', () => {
      expect(normalizeVerdict('PARCIAL')).toBe('PARCIALMENTE_CONFORME');
      expect(normalizeVerdict('PARCIALMENTE')).toBe('PARCIALMENTE_CONFORME');
    });

    it('deve normalizar aprovações para CONFORME', () => {
      expect(normalizeVerdict('CONFORME')).toBe('CONFORME');
      expect(normalizeVerdict('REGULAR')).toBe('CONFORME');
      expect(normalizeVerdict('COMPLIANT')).toBe('CONFORME');
    });
  });

  describe('reconciliationOutputSchema Zod Preprocess', () => {
    it('deve aceitar payload onde violations possuem severity "ALTA" e normalizar para "GRAVE" sem lançar ZodError', () => {
      const rawPayloadFromOllama = {
        verdict: 'NAO_CONFORME',
        score: 45,
        summary: 'Detectada infração de publicidade médica',
        violations: [
          {
            normArticle: 'Artigo 11',
            normCode: 'Res. CFM 2.336/23',
            severity: 'ALTA', // <- O erro relatado pelo usuário
            detectedText: 'Antes e depois de procedimentos sem autorização',
            correctiveAdvice: 'Remover imagens comparativas antes/depois',
          },
          {
            normArticle: 'Artigo 3º',
            normCode: 'Res. CFM 1.974/11',
            severity: 'BAIXA',
            detectedText: 'Falta do número de CRM visível no rodapé',
            correctiveAdvice: 'Inserir CRM e RQE',
          },
        ],
      };

      const parsed = reconciliationOutputSchema.parse(rawPayloadFromOllama);

      expect(parsed.violations[0].severity).toBe('GRAVE');
      expect(parsed.violations[1].severity).toBe('LEVE');
      expect(parsed.verdict).toBe('NAO_CONFORME');
      expect(parsed.score).toBe(45);
    });
  });

  describe('OllamaProvider.reconcile com severidade "ALTA"', () => {
    it('deve processar resposta do Ollama contendo severity="ALTA" com sucesso e mapear para GRAVE', async () => {
      const provider = new OllamaProvider();

      const mockOllamaResponse = {
        verdict: 'NAO_CONFORME',
        score: 30,
        summary: 'Site apresenta infrações deontológicas graves na área de dermatologia.',
        violations: [
          {
            normArticle: 'Art. 11',
            normCode: 'CFM-2336-2023',
            severity: 'ALTA',
            detectedText: 'Preço promocional e fotos de antes e depois',
            correctiveAdvice: 'Remover divulgação de preços e antes/depois',
          },
        ],
      };

      vi.spyOn(security, 'safeHttpPostJson').mockResolvedValueOnce({
        status: 200,
        data: {
          response: JSON.stringify(mockOllamaResponse),
          prompt_eval_count: 120,
          eval_count: 85,
        },
      });

      const scrapeMock: any = {
        url: 'https://03fred.github.io/dermotologista/',
        cleanMarkdown: 'Clínica de dermatologia com fotos de antes e depois e preços',
      };

      const agentContextMock: any = {
        systemPrompt: 'Você é um auditor deontológico. {normasVigentesDoEscopo}',
        activeNorms: [
          {
            id: 'n1',
            normCode: 'CFM-2336-2023',
            article: 'Art. 11',
            title: 'Publicidade Médica',
            content: 'Vedada a divulgação de antes e depois',
            severityDefault: 'GRAVE',
          },
        ],
      };

      const result = await provider.reconcile(scrapeMock, agentContextMock);

      expect(result.aiModelUsed).toContain('ollama');
      expect(result.violations[0].severity).toBe('GRAVE');
      expect(result.verdict).toBe('NAO_CONFORME');
      expect(result.violations[0].normCode).toBe('CFM-2336-2023');
    });
  });
});
