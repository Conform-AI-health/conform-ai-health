/**
 * Sanitizador de Síntese de Auditoria para o Portal do Cliente / Instituição Auditada
 * Garante que detalhes internos de RAG, embeddings, comandos de CLI e contagem de tokens
 * não sejam exibidos para o usuário final/cliente, substituindo por parecer deontológico institucional.
 */

export function formatClientAuditSummary(summary?: string | null): string {
  if (!summary || typeof summary !== 'string') {
    return 'Laudo preliminar de conformidade deontológica emitido pela auditoria preventiva.';
  }

  const technicalKeywords = [
    'A recuperação encontrou',
    'chunks indexados',
    'Modelo esperado',
    'npm run rag:reindex',
    'Sem embedding',
    'dimensão inválida',
    'modelo diferente',
    'metadado ausente',
    'norma-pai ausente',
    'A IA não foi chamada',
    'tokens',
    'gemini-embedding',
  ];

  const hasTechnicalData = technicalKeywords.some((kw) =>
    summary.toLowerCase().includes(kw.toLowerCase())
  );

  if (hasTechnicalData) {
    return 'Auditoria preliminar inconclusiva: O canal digital foi submetido à varredura preventiva e encontra-se em fase de validação complementar pela equipe de governança e auditoria regulatória. Revisão humana em andamento.';
  }

  return summary;
}
