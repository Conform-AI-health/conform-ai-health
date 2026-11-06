import { URL } from 'url';

/**
 * Validação de segurança contra SSRF (Server-Side Request Forgery)
 * Bloqueia chamadas para endereços de loopback, metadados de nuvem e redes privadas
 */
export function validateSafeUrl(urlString: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(urlString);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { safe: false, reason: 'Apenas os protocolos HTTP e HTTPS são permitidos.' };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Bloqueia localhost e loopback
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0'
    ) {
      return { safe: false, reason: 'Acesso a endereços de loopback locais é bloqueado por segurança.' };
    }

    // Bloqueia endpoint de metadados da AWS / nuvem
    if (hostname === '169.254.169.254' || hostname.startsWith('169.254.')) {
      return { safe: false, reason: 'Acesso a serviços de metadados de nuvem é estritamente proibido.' };
    }

    // Bloqueia redes privadas RFC 1918 em produção
    if (
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return { safe: false, reason: 'Acesso a redes privadas internas bloqueado.' };
    }

    return { safe: true };
  } catch (err: any) {
    return { safe: false, reason: `URL inválida ou malformada: ${err.message}` };
  }
}

