/**
 * Utilitário de segurança para higienização e validação de URLs no Frontend (T04 / SEC-02)
 * Previne ataques XSS através de links arbitrários como 'javascript:', 'data:', 'vbscript:'.
 * Retorna a URL segura (http:// ou https://) ou null caso seja insegura/inválida.
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const trimmed = url.trim();

  // Apenas esquemas HTTP e HTTPS legítimos são aceitos
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
  } catch {
    return null;
  }

  return null;
}
