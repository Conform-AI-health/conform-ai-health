import { URL } from 'url';
import dns from 'dns';
import net from 'net';

/**
 * Verifica se um endereço IP (IPv4 ou IPv6) pertence a faixas privadas, loopback,
 * link-local ou reservadas (RFC 1918, RFC 3927, RFC 6598, RFC 4193, etc.)
 */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;

  // Normaliza formato IPv4-mapped IPv6 (ex: "::ffff:127.0.0.1")
  let cleanIp = ip.trim().toLowerCase();
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.substring(7);
  }

  const ipFamily = net.isIP(cleanIp);
  if (ipFamily === 0) {
    return true; // Inválido -> considera não seguro
  }

  if (ipFamily === 4) {
    const parts = cleanIp.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [a, b] = parts;

    // Loopback 127.0.0.0/8 e endereço "este host" 0.0.0.0/8
    if (a === 127 || a === 0) return true;

    // RFC 1918: 10.0.0.0/8
    if (a === 10) return true;

    // RFC 1918: 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // RFC 1918: 192.168.0.0/16
    if (a === 192 && b === 168) return true;

    // RFC 3927 Link-Local / Cloud Metadata: 169.254.0.0/16 (inclui 169.254.169.254)
    if (a === 169 && b === 254) return true;

    // RFC 6598 CGNAT: 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // IETF Protocol Assignments: 192.0.0.0/24
    if (a === 192 && b === 0) return true;

    // Test-Net RFC 5737: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
    if (a === 192 && b === 0 && parts[2] === 2) return true;
    if (a === 198 && b === 51 && parts[2] === 100) return true;
    if (a === 203 && b === 0 && parts[2] === 113) return true;

    // Multicast & Broadcast: 224.0.0.0/4 e 255.255.255.255
    if (a >= 224) return true;

    return false;
  }

  if (ipFamily === 6) {
    // Loopback ::1 ou endereço não especificado ::
    if (cleanIp === '::1' || cleanIp === '::' || cleanIp === '0000:0000:0000:0000:0000:0000:0000:0001') {
      return true;
    }

    // Link-local: fe80::/10 (fe8, fe9, fea, feb)
    if (/^fe[89ab]/i.test(cleanIp)) return true;

    // Unique Local Addresses (ULA): fc00::/7 (fc e fd)
    if (/^f[cd]/i.test(cleanIp)) return true;

    // IPv6 Multicast: ff00::/8
    if (/^ff/i.test(cleanIp)) return true;

    // IPv4-compatible IPv6: ::0.0.0.0 - ::255.255.255.255
    if (cleanIp.startsWith('::') && cleanIp.includes('.')) {
      const ipv4Part = cleanIp.replace('::', '');
      return isPrivateIp(ipv4Part);
    }

    return false;
  }

  return true;
}

/**
 * Validação estática e síncrona de segurança contra SSRF (Server-Side Request Forgery)
 * Bloqueia protocolos inseguros, hostnames literais de loopback, metadados de nuvem e redes RFC 1918
 */
export function validateSafeUrl(urlString: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(urlString);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { safe: false, reason: 'Apenas os protocolos HTTP e HTTPS são permitidos.' };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Bloqueia localhost e loopback explícitos
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local')
    ) {
      return { safe: false, reason: 'Acesso a endereços de loopback locais é bloqueado por segurança.' };
    }

    // Se o hostname for diretamente um endereço IP literal
    if (net.isIP(hostname)) {
      if (isPrivateIp(hostname)) {
        return { safe: false, reason: 'Acesso a endereços IP privados ou reservados é estritamente proibido.' };
      }
    }

    // Bloqueia endpoint de metadados da AWS / GCP / Azure
    if (hostname === '169.254.169.254' || hostname.startsWith('169.254.')) {
      return { safe: false, reason: 'Acesso a serviços de metadados de nuvem é estritamente proibido.' };
    }

    // Bloqueia redes privadas RFC 1918 literais
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

/**
 * Validação assíncrona completa contra SSRF e DNS Rebinding (SEC-02)
 * Resolve os registros DNS de IPv4 e IPv6 do domínio e confirma que nenhum IP aponta para redes internas
 */
export async function validateSafeUrlAsync(urlString: string): Promise<{ safe: boolean; reason?: string }> {
  // 1. Validação estática inicial
  const syncCheck = validateSafeUrl(urlString);
  if (!syncCheck.safe) {
    return syncCheck;
  }

  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();

    // Se já for IP literal e passou pelo syncCheck, já foi validado pelo isPrivateIp
    if (net.isIP(hostname)) {
      return { safe: true };
    }

    // 2. Resolução DNS com lookup para inspecionar todos os endereços retornados
    const resolvedAddresses = await dns.promises.lookup(hostname, { all: true });

    if (!resolvedAddresses || resolvedAddresses.length === 0) {
      return { safe: false, reason: `Não foi possível resolver o endereço de rede para o domínio: ${hostname}` };
    }

    for (const record of resolvedAddresses) {
      if (isPrivateIp(record.address)) {
        return {
          safe: false,
          reason: `Bloqueio de SSRF (DNS Rebinding): o domínio ${hostname} resolve para o endereço privado/restrito ${record.address}.`,
        };
      }
    }

    return { safe: true };
  } catch (err: any) {
    // Falhas de resolução DNS
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
      return { safe: false, reason: `Falha na resolução de DNS para o domínio: ${err.message}` };
    }
    return { safe: false, reason: `Erro ao validar destino de rede: ${err.message}` };
  }
}
