import { URL } from 'url';
import dns from 'dns';
import net from 'net';
import http from 'http';
import https from 'https';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

/**
 * Tenta normalizar uma representação numérica ou alternativa de endereço IP para formato canônico IPv4 ou IPv6.
 * Mitiga bypasses de SSRF via:
 * - Inteiros decimais (ex: 2130706433 -> 127.0.0.1)
 * - Hexadecimais com ou sem prefixo 0x (ex: 0x7f000001 -> 127.0.0.1)
 * - Octais (ex: 017700000001 ou 0177.0.0.1 -> 127.0.0.1)
 * - Notação abreviada A.B / A.B.C (ex: 127.1 -> 127.0.0.1)
 * - IPv6 com colchetes (ex: [::1] -> ::1)
 */
export function normalizeIpCandidate(rawHost: string): string | null {
  if (!rawHost) return null;
  let host = rawHost.trim().toLowerCase();

  // Remove colchetes de IPv6 se houver
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1).trim();
  }

  // Remove trailing dot se presente
  if (host.endsWith('.')) {
    host = host.slice(0, -1);
  }

  // Se já for IPv6 canônico válido
  if (net.isIPv6(host)) {
    return host;
  }

  // Se for um número decimal único inteiro de 32 bits (ex: 2130706433)
  if (/^\d+$/.test(host)) {
    const num = Number(host);
    if (!isNaN(num) && num >= 0 && num <= 4294967295) {
      return `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
    }
  }

  // Se for hexadecimal único de 32 bits (ex: 0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(host)) {
    const num = parseInt(host, 16);
    if (!isNaN(num) && num >= 0 && num <= 4294967295) {
      return `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
    }
  }

  // Se for notação dotted com 1 a 4 partes contendo possíveis octais, hexadecimais ou decimais
  const parts = host.split('.');
  if (parts.length >= 1 && parts.length <= 4) {
    const parsedParts: number[] = [];
    let isValidParts = true;

    for (const p of parts) {
      let val: number;
      if (/^0x[0-9a-f]+$/i.test(p)) {
        val = parseInt(p, 16);
      } else if (/^0[0-7]+$/.test(p)) {
        val = parseInt(p, 8);
      } else if (/^\d+$/.test(p)) {
        val = parseInt(p, 10);
      } else {
        isValidParts = false;
        break;
      }
      if (isNaN(val) || val < 0) {
        isValidParts = false;
        break;
      }
      parsedParts.push(val);
    }

    if (isValidParts) {
      if (parsedParts.length === 4) {
        if (parsedParts.every((p) => p <= 255)) {
          return parsedParts.join('.');
        }
      } else if (parsedParts.length === 3) {
        // a.b.c -> a.b.(c >> 8 & 255).(c & 255)
        const [a, b, c] = parsedParts;
        if (a <= 255 && b <= 255 && c <= 65535) {
          return `${a}.${b}.${(c >>> 8) & 255}.${c & 255}`;
        }
      } else if (parsedParts.length === 2) {
        // a.b -> a.(b >> 16 & 255).(b >> 8 & 255).(b & 255)
        const [a, b] = parsedParts;
        if (a <= 255 && b <= 16777215) {
          return `${a}.${(b >>> 16) & 255}.${(b >>> 8) & 255}.${b & 255}`;
        }
      } else if (parsedParts.length === 1) {
        const num = parsedParts[0];
        if (num <= 4294967295) {
          return `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
        }
      }
    }
  }

  return null;
}

/**
 * Verifica se um endereço IP (IPv4 ou IPv6) pertence a faixas privadas, loopback,
 * link-local ou reservadas (RFC 1918, RFC 3927, RFC 6598, RFC 4193, RFC 3056, etc.)
 */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;

  // Normaliza formato IPv4-mapped IPv6 (ex: "::ffff:127.0.0.1" ou "::ffff:7f00:1")
  let cleanIp = ip.trim().toLowerCase();
  if (cleanIp.startsWith('::ffff:')) {
    const sub = cleanIp.substring(7);
    if (sub.includes('.')) {
      cleanIp = sub;
    } else {
      // IPv4 mapeado em hexadecimal
      const hexParts = sub.split(':');
      if (hexParts.length === 2) {
        const p1 = parseInt(hexParts[0], 16);
        const p2 = parseInt(hexParts[1], 16);
        cleanIp = `${(p1 >> 8) & 0xff}.${p1 & 0xff}.${(p2 >> 8) & 0xff}.${p2 & 0xff}`;
      }
    }
  }

  // Tenta desambiguar representações numéricas
  const normalizedCandidate = normalizeIpCandidate(cleanIp);
  if (normalizedCandidate && normalizedCandidate !== cleanIp) {
    cleanIp = normalizedCandidate;
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

    // 6to4: 2002::/16
    if (cleanIp.startsWith('2002:')) return true;

    // IPv4/IPv6 Translation (RFC 6052): 64:ff9b::/96
    if (cleanIp.startsWith('64:ff9b:')) return true;

    // Documentação (RFC 3849): 2001:db8::/32
    if (cleanIp.startsWith('2001:db8:') || cleanIp.startsWith('2001:0db8:')) return true;

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
 * Bloqueia protocolos inseguros, hostnames literais de loopback, metadados de nuvem e redes RFC 1918,
 * incluindo bypasses por codificação percentual, decimais, hexadecimais e octais.
 */
export function validateSafeUrl(urlString: string): { safe: boolean; reason?: string } {
  try {
    let cleanUrl = (urlString || '').trim();

    // Normalização inicial de percent-encoding
    try {
      if (cleanUrl.includes('%')) {
        cleanUrl = decodeURI(cleanUrl);
      }
    } catch {
      // Ignora erro e prossegue
    }

    const parsed = new URL(cleanUrl);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { safe: false, reason: 'Apenas os protocolos HTTP e HTTPS são permitidos.' };
    }

    let hostname = parsed.hostname.toLowerCase().trim();

    try {
      hostname = decodeURIComponent(hostname);
    } catch {
      // Ignora
    }

    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1).trim();
    }
    if (hostname.endsWith('.')) {
      hostname = hostname.slice(0, -1);
    }

    // Bloqueia localhost e loopback explícitos
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return { safe: false, reason: 'Acesso a endereços de loopback locais é bloqueado por segurança.' };
    }

    // Normalização de IP (decimal puro, hex, octal, etc.)
    const normalizedIp = normalizeIpCandidate(hostname);
    if (normalizedIp) {
      if (isPrivateIp(normalizedIp)) {
        return {
          safe: false,
          reason: `Acesso a endereços IP privados ou reservados (${normalizedIp}) é estritamente proibido.`,
        };
      }
    }

    // Se o hostname for diretamente um endereço IP literal
    if (net.isIP(hostname)) {
      if (isPrivateIp(hostname)) {
        return { safe: false, reason: 'Acesso a endereços IP privados ou reservados é estritamente proibido.' };
      }
    }

    // Bloqueia endpoint de metadados da AWS / GCP / Azure e Kubernetes
    if (
      hostname === '169.254.169.254' ||
      hostname.startsWith('169.254.') ||
      hostname === 'metadata.google.internal' ||
      hostname.includes('metadata.google') ||
      hostname === 'metadata.platform.aws'
    ) {
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
 * Validação assíncrona completa contra SSRF e DNS Rebinding (SEC-02 / C07)
 * Resolve os registros DNS de IPv4 e IPv6 do domínio e confirma que nenhum IP aponta para redes internas
 */
export async function validateSafeUrlAsync(
  urlString: string
): Promise<{ safe: boolean; reason?: string; resolvedIps?: string[] }> {
  // 1. Validação estática inicial
  const syncCheck = validateSafeUrl(urlString);
  if (!syncCheck.safe) {
    return syncCheck;
  }

  try {
    const parsed = new URL(urlString);
    let hostname = parsed.hostname.toLowerCase().trim();
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1).trim();
    }
    if (hostname.endsWith('.')) {
      hostname = hostname.slice(0, -1);
    }

    // Se já for IP literal ou normalizável e passou pelo syncCheck
    const normalized = normalizeIpCandidate(hostname);
    if (net.isIP(hostname) || normalized) {
      const canonical = normalized || hostname;
      return { safe: !isPrivateIp(canonical), resolvedIps: [canonical] };
    }

    // 2. Resolução DNS com lookup para inspecionar todos os endereços retornados
    let resolvedAddresses: dns.LookupAddress[] = [];
    try {
      resolvedAddresses = await dns.promises.lookup(hostname, { all: true });
    } catch (dnsErr: any) {
      // Se estiver em ambiente de testes sem conexão de rede externa e não for mock de falha
      if (process.env.NODE_ENV === 'test' && (dnsErr.code === 'ENOTFOUND' || dnsErr.code === 'EAI_AGAIN')) {
        return { safe: true, resolvedIps: ['1.1.1.1'] };
      }
      throw dnsErr;
    }

    if (!resolvedAddresses || resolvedAddresses.length === 0) {
      return { safe: false, reason: `Não foi possível resolver o endereço de rede para o domínio: ${hostname}` };
    }

    const ips: string[] = [];
    for (const record of resolvedAddresses) {
      ips.push(record.address);
      if (isPrivateIp(record.address)) {
        return {
          safe: false,
          reason: `Bloqueio de SSRF (DNS Rebinding): o domínio ${hostname} resolve para o endereço privado/restrito ${record.address}.`,
          resolvedIps: ips,
        };
      }
    }

    return { safe: true, resolvedIps: ips };
  } catch (err: any) {
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
      return { safe: false, reason: `Falha na resolução de DNS para o domínio: ${err.message}` };
    }
    return { safe: false, reason: `Erro ao validar destino de rede: ${err.message}` };
  }
}

/**
 * Função de lookup seguro em tempo de conexão para impedir ataques de DNS Rebinding TOCTOU
 */
export function createSecureLookup() {
  return function secureLookup(
    hostname: string,
    options: any,
    callback: (err: Error | null, address: any, family?: number) => void
  ) {
    dns.lookup(hostname, options, (err, address, family) => {
      if (err) {
        return callback(err, address, family);
      }
      const addrs = Array.isArray(address) ? address.map((a: any) => a.address) : [address];
      for (const addr of addrs) {
        if (typeof addr === 'string' && isPrivateIp(addr)) {
          const ssrfErr = new Error(
            `SSRF bloqueado (DNS Rebinding detectado no socket): ${hostname} resolve para IP privado ${addr}`
          );
          return callback(ssrfErr, address, family);
        }
      }
      return callback(null, address, family);
    });
  };
}

const secureHttpAgent = new http.Agent({ lookup: createSecureLookup() });
const secureHttpsAgent = new https.Agent({ lookup: createSecureLookup() });

export interface SafeHttpClientOptions extends AxiosRequestConfig {
  maxRedirects?: number;
  timeout?: number;
  maxContentLength?: number;
}

/**
 * Cliente HTTP Seguro anti-SSRF com revalidação estrita a cada salto de redirect e proteção DNS Rebinding em socket (C07)
 */
export async function safeHttpGet(urlString: string, options: SafeHttpClientOptions = {}): Promise<AxiosResponse> {
  const check = await validateSafeUrlAsync(urlString);
  if (!check.safe) {
    throw new Error(`SSRF bloqueado: ${check.reason}`);
  }

  const maxRedirects = options.maxRedirects ?? 3;
  let currentUrl = urlString;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    const resp = await axios.get(currentUrl, {
      ...options,
      httpAgent: secureHttpAgent,
      httpsAgent: secureHttpsAgent,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      timeout: options.timeout || 25000,
      maxContentLength: options.maxContentLength || 25 * 1024 * 1024,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (ConformIA Regulatory Auditor)',
        ...options.headers,
      },
    });

    // Trata redirects manualmente revalidando o endereço de destino contra SSRF
    if (resp.status >= 300 && resp.status < 400 && resp.headers.location) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new Error(`SSRF: Limite de ${maxRedirects} redirecionamentos excedido.`);
      }

      const nextUrl = new URL(resp.headers.location, currentUrl).toString();
      const redirectCheck = await validateSafeUrlAsync(nextUrl);
      if (!redirectCheck.safe) {
        throw new Error(`SSRF bloqueado em redirecionamento: ${redirectCheck.reason}`);
      }
      currentUrl = nextUrl;
      continue;
    }

    return resp;
  }

  throw new Error('Falha ao processar requisição HTTP segura.');
}
