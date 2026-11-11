import dns from 'dns';
import http from 'http';
import net from 'net';
import { Duplex } from 'stream';
import { validateSafeUrl, isPrivateIp } from './security.js';

type ResolvedTarget = {
  address: string;
  family: number;
};

function getHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

async function resolvePublicTarget(url: URL): Promise<ResolvedTarget> {
  const staticCheck = validateSafeUrl(url.toString());
  if (!staticCheck.safe || url.username || url.password) {
    throw new Error(staticCheck.reason || 'Credenciais na URL não são permitidas.');
  }

  const hostname = getHostname(url.hostname);
  const ipFamily = net.isIP(hostname);
  const addresses = ipFamily
    ? [{ address: hostname, family: ipFamily }]
    : await dns.promises.lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error(`Destino privado ou não resolvido bloqueado: ${hostname}`);
  }

  return addresses[0];
}

function rejectRequest(response: http.ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
  response.end(message);
}

async function proxyHttpRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    rejectRequest(response, 405, 'Method not allowed');
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(request.url || '');
  } catch {
    rejectRequest(response, 400, 'Absolute URL required');
    return;
  }

  if (targetUrl.protocol !== 'http:') {
    rejectRequest(response, 400, 'Only HTTP proxy requests are supported');
    return;
  }

  let target: ResolvedTarget;
  try {
    target = await resolvePublicTarget(targetUrl);
  } catch (error) {
    rejectRequest(response, 403, error instanceof Error ? error.message : 'Destination blocked');
    return;
  }

  const headers: http.OutgoingHttpHeaders = { ...request.headers, host: targetUrl.host, connection: 'close' };
  delete headers['proxy-authorization'];
  delete headers['proxy-connection'];

  const upstream = http.request(
    {
      hostname: target.address,
      family: target.family,
      port: Number(targetUrl.port) || 80,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: request.method,
      headers,
      agent: false,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    }
  );

  upstream.setTimeout(15000, () => upstream.destroy(new Error('Upstream request timed out')));
  upstream.on('error', (error) => {
    if (!response.headersSent) {
      rejectRequest(response, 502, error.message);
    } else {
      response.destroy(error);
    }
  });
  request.pipe(upstream);
}

async function proxyHttpsConnect(
  request: http.IncomingMessage,
  clientSocket: Duplex,
  head: Buffer
): Promise<void> {
  let targetUrl: URL;
  try {
    targetUrl = new URL(`https://${request.url || ''}`);
  } catch {
    clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }

  // T28: Restringe portas do túnel CONNECT estritamente para portas HTTPS seguras (443, 8443)
  const targetPort = Number(targetUrl.port) || 443;
  const ALLOWED_CONNECT_PORTS = [443, 8443];
  if (!ALLOWED_CONNECT_PORTS.includes(targetPort)) {
    clientSocket.end('HTTP/1.1 403 Forbidden: Port not allowed for CONNECT\r\n\r\n');
    return;
  }

  let target: ResolvedTarget;
  try {
    target = await resolvePublicTarget(targetUrl);
  } catch {
    clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }

  const upstream = net.connect({
    host: target.address,
    family: target.family,
    port: targetPort,
  });

  upstream.setTimeout(15000, () => upstream.destroy(new Error('Upstream connection timed out')));
  upstream.once('connect', () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
  clientSocket.on('error', () => upstream.destroy());
  clientSocket.on('close', () => upstream.destroy());
}

export async function startSafeScrapingProxy(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    void proxyHttpRequest(request, response).catch((error: unknown) => {
      if (!response.headersSent) {
        rejectRequest(response, 502, error instanceof Error ? error.message : 'Upstream request failed');
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
    });
  });
  server.on('connect', (request, socket, head) => {
    void proxyHttpsConnect(request, socket, head).catch(() => {
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    throw new Error('Unable to bind safe scraping proxy to a local port.');
  }

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
