import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { startSafeScrapingProxy } from '../shared/safeScrapingProxy.js';

describe('safe scraping proxy', () => {
  let proxy: Awaited<ReturnType<typeof startSafeScrapingProxy>> | undefined;
  let targetServer: http.Server | undefined;

  afterEach(async () => {
    if (proxy) await proxy.close();
    if (targetServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        targetServer?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    proxy = undefined;
    targetServer = undefined;
  });

  it('blocks HTTP requests to loopback before forwarding them', async () => {
    let targetRequests = 0;
    targetServer = http.createServer((_request, response) => {
      targetRequests += 1;
      response.end('private');
    });
    await new Promise<void>((resolve) => targetServer?.listen(0, '127.0.0.1', resolve));
    const targetAddress = targetServer.address();
    if (!targetAddress || typeof targetAddress === 'string') {
      throw new Error('Unable to start loopback test server.');
    }

    proxy = await startSafeScrapingProxy();
    const response = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      const request = http.get(
        {
          hostname: '127.0.0.1',
          port: proxy?.port,
          path: `http://127.0.0.1:${targetAddress.port}/private`,
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (body += chunk));
          res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        }
      );
      request.on('error', reject);
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('bloqueado');
    expect(targetRequests).toBe(0);
  });
});
