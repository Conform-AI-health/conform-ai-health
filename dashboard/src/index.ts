import dns from 'node:dns';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { runAutoMigrateAndSeed } from './shared/autoMigrate.js';
import { createLogger } from './shared/logger.js';
import { initTracing, shutdownTracing } from './shared/tracing.js';
import { initDistributedResilience } from './shared/distributedResilience.js';

// Garante resolução IPv4 prioritária em ambientes conteinerizados Docker para evitar falhas de ENETUNREACH
dns.setDefaultResultOrder('ipv4first');

const log = createLogger('Bootstrap');

async function bootstrap() {
  initTracing(env.SERVICE_NAME || 'conformia-api');
  initDistributedResilience();
  const app = createApp();

  // Executa auto-migração e provisionamento estrito inicial (T03)
  if (env.NODE_ENV !== 'test') {
    try {
      await runAutoMigrateAndSeed();
    } catch (err: any) {
      log.fatal(
        { err },
        `Falha crítica de inicialização/provisionamento no banco de dados: ${err.message}`
      );
      process.exit(1);
    }
  }

  const server = app.listen(env.PORT, () => {
    log.info(
      {
        port: env.PORT,
        apiPrefix: env.API_PREFIX,
        aiProvider: env.AI_PROVIDER,
        version: env.APP_VERSION,
        environment: env.APP_ENV || env.NODE_ENV,
      },
      'ConformIA Backend API ativa e pronta para auditorias'
    );
  });

  // INF-03: Graceful Shutdown Coordenado do Servidor HTTP, Tracing e Conexões de Banco
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Sinal recebido. Encerrando servidor HTTP gracefully...');

    const forceExitTimeout = setTimeout(() => {
      log.error('Timeout de encerramento excedido (10s). Forçando finalização do processo.');
      process.exit(1);
    }, 10000);
    forceExitTimeout.unref();

    try {
      await new Promise<void>((resolve) => {
        server.close((err) => {
          if (err) log.warn({ err }, 'Aviso ao fechar servidor HTTP');
          log.info('Servidor HTTP finalizado.');
          resolve();
        });
      });

      const { prisma } = await import('./config/prisma.js');
      if (typeof (prisma as any).$disconnect === 'function') {
        await prisma.$disconnect();
        log.info('Conexão com MongoDB finalizada.');
      }

      await shutdownTracing();
      clearTimeout(forceExitTimeout);
      log.info('Finalização graciosa concluída com sucesso.');
      process.exit(0);
    } catch (err: any) {
      clearTimeout(forceExitTimeout);
      log.error({ err }, 'Erro durante shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  log.fatal({ err }, 'Falha fatal ao iniciar ConformIA Backend');
  process.exit(1);
});
