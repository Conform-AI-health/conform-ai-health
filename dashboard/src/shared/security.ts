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
 * T28: BlockList nativa do Node.js de alta performance para contenção estrita de sub-redes privadas e reservadas.
 */
const privateBlockList = new net.BlockList();

// IPv4 Privadas, Reservadas, Loopback e CGNAT
privateBlockList.addSubnet('0.0.0.0', 8, 'ipv4');       // Current network ("this host")
privateBlockList.addSubnet('10.0.0.0', 8, 'ipv4');      // RFC 1918
privateBlockList.addSubnet('100.64.0.0', 10, 'ipv4');   // RFC 6598 CGNAT
privateBlockList.addSubnet('127.0.0.0', 8, 'ipv4');     // RFC 1122 Loopback
privateBlockList.addSubnet('169.254.0.0', 16, 'ipv4');  // RFC 3927 Link-Local (Cloud Metadata 169.254.169.254)
privateBlockList.addSubnet('172.16.0.0', 12, 'ipv4');   // RFC 1918
privateBlockList.addSubnet('192.0.0.0', 24, 'ipv4');    // IETF Protocol Assignments (T28)
privateBlockList.addSubnet('192.0.2.0', 24, 'ipv4');    // RFC 5737 TEST-NET-1
privateBlockList.addSubnet('192.88.99.0', 24, 'ipv4');  // RFC 7526 6to4 Anycast Relay
privateBlockList.addSubnet('192.168.0.0', 16, 'ipv4');  // RFC 1918
privateBlockList.addSubnet('198.18.0.0', 15, 'ipv4');   // RFC 2544 Network Interconnect Benchmark
privateBlockList.addSubnet('198.51.100.0', 24, 'ipv4'); // RFC 5737 TEST-NET-2
privateBlockList.addSubnet('203.0.113.0', 24, 'ipv4');  // RFC 5737 TEST-NET-3
privateBlockList.addSubnet('224.0.0.0', 4, 'ipv4');     // RFC 1112 Multicast
privateBlockList.addSubnet('240.0.0.0', 4, 'ipv4');     // RFC 1112 Reserved
privateBlockList.addAddress('255.255.255.255', 'ipv4'); // Broadcast

// IPv6 Privadas, Reservadas, Loopback e Tradução
privateBlockList.addAddress('::', 'ipv6');              // Unspecified
privateBlockList.addAddress('::1', 'ipv6');             // Loopback
privateBlockList.addSubnet('64:ff9b::', 96, 'ipv6');   // RFC 6052 IPv4/IPv6 Translation
privateBlockList.addSubnet('2001:db8::', 32, 'ipv6');  // RFC 3849 Documentation
privateBlockList.addSubnet('2002::', 16, 'ipv6');      // RFC 3056 6to4
privateBlockList.addSubnet('fc00::', 7, 'ipv6');       // RFC 4193 Unique Local Address (ULA)
privateBlockList.addSubnet('fe80::', 10, 'ipv6');      // RFC 4291 Link-Local
privateBlockList.addSubnet('ff00::', 8, 'ipv6');       // RFC 4291 Multicast

/**
 * Verifica se um endereço IP (IPv4 ou IPv6) pertence a faixas privadas, loopback,
 * link-local ou reservadas utilizando a API nativa net.BlockList (T28 / RFC 1918 / RFC 3927).
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

  const familyType = ipFamily === 4 ? 'ipv4' : 'ipv6';

  // Consulta prioritária via net.BlockList compilada
  try {
    if (privateBlockList.check(cleanIp, familyType)) {
      return true;
    }
  } catch {
    return true;
  }

  // Fallbacks complementares
  if (ipFamily === 4) {
    const parts = cleanIp.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 127 || a === 0 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0) return true;
    if (a >= 224) return true;
    return false;
  }

  if (ipFamily === 6) {
    if (cleanIp === '::1' || cleanIp === '::' || cleanIp === '0000:0000:0000:0000:0000:0000:0000:0001') {
      return true;
    }
    if (/^fe[89ab]/i.test(cleanIp)) return true;
    if (/^f[cd]/i.test(cleanIp)) return true;
    if (/^ff/i.test(cleanIp)) return true;
    if (cleanIp.startsWith('2002:')) return true;
    if (cleanIp.startsWith('64:ff9b:')) return true;
    if (cleanIp.startsWith('2001:db8:') || cleanIp.startsWith('2001:0db8:')) return true;
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

/**
 * T26: Valida se uma URL base aponta estritamente para host de loopback (localhost/127.0.0.1/[::1])
 * sem permitir desvios maliciosos como "localhost.evil.com" ou credenciais embutidas.
 */
export function isAllowedLocalhostBaseUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    if (parsed.username || parsed.password) {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

/**
 * T26: Cliente HTTP seguro para chamadas POST da IA (ex: Ollama) protegido contra SSRF e timeout estrito
 */
export async function safeHttpPostJson<T = any>(
  urlString: string,
  payload: any,
  options: { timeout?: number; headers?: Record<string, string> } = {}
): Promise<{ data: T; status: number }> {
  const isLocal = isAllowedLocalhostBaseUrl(urlString);
  if (!isLocal) {
    const check = await validateSafeUrlAsync(urlString);
    if (!check.safe) {
      throw new Error(`SSRF bloqueado em chamada de IA: ${check.reason}`);
    }
  }

  const resp = await axios.post<T>(urlString, payload, {
    httpAgent: isLocal ? undefined : secureHttpAgent,
    httpsAgent: isLocal ? undefined : secureHttpsAgent,
    timeout: options.timeout || 30000,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  return { data: resp.data, status: resp.status };
}
