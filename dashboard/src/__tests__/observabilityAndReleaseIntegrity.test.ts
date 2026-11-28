import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import request from 'supertest';
import { SpanKind } from '@opentelemetry/api';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    $runCommandRaw: vi.fn().mockResolvedValue({ ok: 1 }),
    systemLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock('../config/redis.js', () => ({
  getRedisConnection: vi.fn().mockReturnValue({ ping: vi.fn().mockResolvedValue('PONG') }),
  auditQueue: { count: vi.fn().mockResolvedValue(0) },
  normCrawlQueue: { count: vi.fn().mockResolvedValue(0) },
}));

import { createLoggerForStream, LOGGER_REDACT_PATHS } from '../shared/logger.js';
import {
  extractTraceContext,
  getActiveTraceIds,
  initTracing,
  injectTraceCarrier,
  runWithContext,
  shutdownTracing,
  withSpan,
} from '../shared/tracing.js';
import { createApp } from '../app.js';

function createMemoryLogSink() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });

  return {
    stream,
    getRecords: (): Record<string, any>[] =>
      lines
        .join('')
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l)),
  };
}

describe('📊 Observabilidade (Pino + LGPD Redact + OTel W3C) & Releases Imutáveis', () => {
  const rootDir = path.resolve(__dirname, '../../../');

  beforeEach(() => {
    initTracing('conformia-test');
  });

  afterEach(async () => {
    await shutdownTracing();
  });

  describe('1. Logger Estruturado Pino & Redação LGPD', () => {
    it('deve emitir JSON estruturado com service, env, version, module e contexto distribuído', async () => {
      const sink = createMemoryLogSink();
      const testLogger = createLoggerForStream(sink.stream, 'AuditUnit', 'info');

      await runWithContext(
        {
          requestId: 'req-abc-123',
          clientId: 'clinic-001',
          auditReportId: 'report-999',
        },
        async () => {
          await withSpan('unit.test.span', { 'audit.report_id': 'report-999' }, async () => {
            testLogger.info({ action: 'validate_norm' }, 'Evento auditável de teste');
          });
        }
      );

      const records = sink.getRecords();
      expect(records.length).toBe(1);

      const entry = records[0];
      expect(entry.level).toBe('info');
      expect(entry.service).toBeDefined();
      expect(entry.env).toBeDefined();
      expect(entry.version).toBeDefined();
      expect(entry.module).toBe('AuditUnit');
      expect(entry.requestId).toBe('req-abc-123');
      expect(entry.clientId).toBe('clinic-001');
      expect(entry.auditReportId).toBe('report-999');
      expect(entry.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(entry.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(entry.msg).toBe('Evento auditável de teste');
    });

    it('deve redigir obrigatoriamente segredos, credenciais HTTP e dados sensíveis (LGPD) com [REDACTED]', () => {
      const sink = createMemoryLogSink();
      const testLogger = createLoggerForStream(sink.stream, 'SecurityRedact', 'info');

      expect(LOGGER_REDACT_PATHS).toContain('req.headers.authorization');
      expect(LOGGER_REDACT_PATHS).toContain('password');
      expect(LOGGER_REDACT_PATHS).toContain('cpf');

      testLogger.info(
        {
          password: 'MySecretPassword123!',
          passwordHash: 'hash_abc',
          apiKey: 'AIzaSySecretKey',
          token: 'jwt_token_value',
          refreshToken: 'refresh_token_value',
          cpf: '123.456.789-00',
          req: {
            headers: {
              authorization: 'Bearer top-secret-jwt',
              cookie: 'refresh=secret-cookie',
              'x-api-key': 'secret-monitoring-key',
            },
          },
          payload: {
            password: 'nested-password',
            authPassword: 'nested-auth-password',
            cpf: '999.888.777-66',
          },
          safeField: 'clinica-modelo',
        },
        'Payload sanitizado'
      );

      const records = sink.getRecords();
      expect(records.length).toBe(1);
      const entry = records[0];

      expect(entry.password).toBe('[REDACTED]');
      expect(entry.passwordHash).toBe('[REDACTED]');
      expect(entry.apiKey).toBe('[REDACTED]');
      expect(entry.token).toBe('[REDACTED]');
      expect(entry.refreshToken).toBe('[REDACTED]');
      expect(entry.cpf).toBe('[REDACTED]');
      expect(entry.req.headers.authorization).toBe('[REDACTED]');
      expect(entry.req.headers.cookie).toBe('[REDACTED]');
      expect(entry.req.headers['x-api-key']).toBe('[REDACTED]');
      expect(entry.payload.password).toBe('[REDACTED]');
      expect(entry.payload.authPassword).toBe('[REDACTED]');
      expect(entry.payload.cpf).toBe('[REDACTED]');
      expect(entry.safeField).toBe('clinica-modelo');
    });
  });

  describe('2. Tracing Distribuído OpenTelemetry W3C (API -> BullMQ -> Worker)', () => {
    it('deve propagar o mesmo traceId entre spans filhos e através da fronteira BullMQ', async () => {
      let parentTraceId: string | undefined;
      let childTraceId: string | undefined;
      let carrier: Record<string, string> = {};

      await runWithContext({ requestId: 'req-flow-777' }, async () => {
        await withSpan('api.enqueue_audit', { 'audit.report_id': 'rep-777' }, async () => {
          parentTraceId = getActiveTraceIds().traceId;
          carrier = injectTraceCarrier();
        });
      });

      expect(parentTraceId).toMatch(/^[0-9a-f]{32}$/);
      expect(carrier.traceparent).toContain(parentTraceId!);
      expect(carrier['x-request-id']).toBe('req-flow-777');

      const extractedCtx = extractTraceContext(carrier);
      let workerContextRequestId: string | undefined;

      await runWithContext({ requestId: carrier['x-request-id'] }, async () => {
        await withSpan(
          'bullmq.process.auditJob',
          { 'messaging.system': 'bullmq' },
          async () => {
            childTraceId = getActiveTraceIds().traceId;
            workerContextRequestId = carrier['x-request-id'];
          },
          { kind: SpanKind.CONSUMER, parentContext: extractedCtx }
        );
      });

      expect(childTraceId).toBe(parentTraceId);
      expect(workerContextRequestId).toBe('req-flow-777');
    });

    it('deve registrar exceção no span quando a operação falhar e relançar o erro', async () => {
      await expect(
        withSpan('failing.operation', {}, async () => {
          throw new Error('Falha simulada controlada');
        })
      ).rejects.toThrow('Falha simulada controlada');
    });
  });

  describe('3. Middleware HTTP & /health Release Metadata', () => {
    const app = createApp();

    it('deve retornar X-Request-Id, X-Trace-Id e metadados de versão no GET /health', async () => {
      const res = await request(app)
        .get('/health')
        .set('x-request-id', 'custom-req-id-2026');

      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe('custom-req-id-2026');
      expect(res.headers['x-trace-id']).toMatch(/^[0-9a-f]{32}$/);
      expect(res.body.status).toBe('UP');
      expect(res.body.version).toBeDefined();
      expect(res.body.environment).toBeDefined();
    });

    it('deve herdar traceparent W3C enviado pelo cliente/proxy', async () => {
      const incomingTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const traceparent = `00-${incomingTraceId}-00f067aa0ba902b7-01`;

      const res = await request(app)
        .get('/health')
        .set('traceparent', traceparent);

      expect(res.status).toBe(200);
      expect(res.headers['x-trace-id']).toBe(incomingTraceId);
    });
  });

  describe('4. Integridade de Versionamento Imutável, Staging, Rollback & Retenção de Disco', () => {
    it('docker-compose.yml não deve usar tag :latest e deve configurar rotação json-file', () => {
      const composePath = path.join(rootDir, 'docker-compose.yml');
      const content = fs.readFileSync(composePath, 'utf8');

      expect(content).not.toMatch(/\$\{APP_VERSION:-latest\}/);
      expect(content).not.toMatch(/conform-ai-health\/dashboard-(api|web):latest/);
      expect(content).toMatch(/driver:\s*"json-file"/);
      expect(content).toMatch(/max-size:\s*"20m"/);
      expect(content).toMatch(/max-file:\s*"5"/);
      expect(content).toMatch(/OTEL_EXPORTER_OTLP_ENDPOINT/);
    });

    it('arquivos de Staging devem existir isolados (.env.staging.example e docker-compose.staging.yml)', () => {
      const stagingCompose = path.join(rootDir, 'docker-compose.staging.yml');
      const stagingEnvExample = path.join(rootDir, '.env.staging.example');

      expect(fs.existsSync(stagingCompose)).toBe(true);
      expect(fs.existsSync(stagingEnvExample)).toBe(true);

      const composeContent = fs.readFileSync(stagingCompose, 'utf8');
      expect(composeContent).toMatch(/conformia-staging-api/);
      expect(composeContent).toMatch(/APP_ENV=staging/);

      const envContent = fs.readFileSync(stagingEnvExample, 'utf8');
      expect(envContent).toMatch(/conformia_staging/);
      expect(envContent).toMatch(/^RESEND_API_KEY=$/m);
    });

    it('ec2-disk-cleanup.sh não deve truncar logs ativos nem apagar todas as imagens sem retenção', () => {
      const cleanupPath = path.join(rootDir, 'scripts/ec2-disk-cleanup.sh');
      const content = fs.readFileSync(cleanupPath, 'utf8');

      expect(content).not.toMatch(/truncate\s+-s\s+0/);
      expect(content).not.toMatch(/docker\s+image\s+prune\s+-af/);
      expect(content).toMatch(/KEEP_RELEASES/);
      expect(content).toMatch(/\.current_version/);
      expect(content).toMatch(/\.previous_version/);
    });

    it('ec2-deploy-release.sh deve existir, rejeitar latest e liberar a imagem atual antes do pull (auto-rollback desativado em homologação)', () => {
      const deployScriptPath = path.join(rootDir, 'scripts/ec2-deploy-release.sh');
      expect(fs.existsSync(deployScriptPath)).toBe(true);

      const content = fs.readFileSync(deployScriptPath, 'utf8').replace(/\r\n/g, '\n');
      expect(content).toMatch(/latest/);
      expect(content).toMatch(/\.previous_version/);
      expect(content).toMatch(/releases\.log/);
      expect(content).toMatch(/AUTO-ROLLBACK DESATIVADO/);
      expect(content).not.toMatch(/^\s*run_compose "\$PREVIOUS_VERSION" up/m);
      expect(content.indexOf('remove_local_app_images\n')).toBeLessThan(content.indexOf('pull\n'));
      expect(content.indexOf('[0/4]')).toBeGreaterThan(-1);
      expect(content.indexOf('[0/4]')).toBeLessThan(content.indexOf('pull\n'));
    });

    it('workflows CI/CD (ci-deploy.yml e rollback.yml) devem usar tags imutáveis sha- e gate de produção (staging desativado em homologação)', () => {
      const ciPath = path.join(rootDir, '.github/workflows/ci-deploy.yml');
      const rollbackPath = path.join(rootDir, '.github/workflows/rollback.yml');

      expect(fs.existsSync(ciPath)).toBe(true);
      expect(fs.existsSync(rollbackPath)).toBe(true);

      const ciContent = fs.readFileSync(ciPath, 'utf8');
      expect(ciContent).toMatch(/sha-\$\{SHORT_SHA\}/);
      expect(ciContent).toMatch(/environment:\s*production/);
      expect(ciContent).toMatch(/needs:\s*\[build-docker-images\]/);
      expect(ciContent).not.toMatch(/^  deploy-staging:/m);
      expect(ciContent).not.toMatch(/dashboard-api:latest/);
      expect(ciContent).not.toMatch(/dashboard-api:1\.0\.0/);

      const rollbackContent = fs.readFileSync(rollbackPath, 'utf8');
      expect(rollbackContent).toMatch(/workflow_dispatch/);
      expect(rollbackContent).toMatch(/target_version/);
      expect(rollbackContent).toMatch(/ACTION=ROLLBACK/);
    });
  });
});
