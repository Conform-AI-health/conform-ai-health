import { describe, it, expect } from 'vitest';
import { formatClientAuditSummary } from '../utils/summarySanitizer';

describe('formatClientAuditSummary', () => {
  it('deve retornar mensagem institucional amigável quando o summary contiver dados técnicos de RAG', () => {
    const rawTechnicalSummary =
      'Auditoria inconclusiva: A recuperação encontrou 56/102 chunks indexados. Modelo esperado: "gemini-embedding-001:768". Sem embedding: 46; dimensão inválida: 0; modelo diferente: 46; metadado ausente: 0; norma-pai ausente: 0. A IA não foi chamada (0 tokens). Gere os embeddings na mesma base usada pela aplicação e verifique a saída de `npm run rag:reindex`. Revisão humana obrigatória.';

    const formatted = formatClientAuditSummary(rawTechnicalSummary);

    expect(formatted).not.toContain('gemini-embedding');
    expect(formatted).not.toContain('npm run rag:reindex');
    expect(formatted).not.toContain('chunks indexados');
    expect(formatted).not.toContain('0 tokens');
    expect(formatted).toBe(
      'Auditoria preliminar inconclusiva: O canal digital foi submetido à varredura preventiva e encontra-se em fase de validação complementar pela equipe de governança e auditoria regulatória. Revisão humana em andamento.'
    );
  });

  it('deve preservar resumos normais e institucionais que não contenham vazamento técnico', () => {
    const regularSummary =
      'O website da clínica apresenta conformidade satisfatória com as diretrizes do CFM 2.336/2023, restando apenas pequenas adequações no rodapé.';

    const formatted = formatClientAuditSummary(regularSummary);
    expect(formatted).toBe(regularSummary);
  });

  it('deve retornar fallback seguro para resumos vazios ou nulos', () => {
    expect(formatClientAuditSummary(null)).toContain('Laudo preliminar de conformidade');
    expect(formatClientAuditSummary('')).toContain('Laudo preliminar de conformidade');
  });
});
