import dns from 'node:dns';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { runAutoMigrateAndSeed } from './shared/autoMigrate.js';
import { AuditSchedulerService } from './services/auditSchedulerService.js';

// Garante resolução IPv4 prioritária em ambientes conteinerizados Docker para evitar falhas de ENETUNREACH
dns.setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const app = createApp();

  // Executa auto-migração e seed apenas se não estiver em ambiente de teste
  if (env.NODE_ENV !== 'test') {
    try {
      await runAutoMigrateAndSeed();
    } catch (err: any) {
      console.warn(`[Bootstrap] Aviso no seed inicial: ${err.message}. Continuando inicialização do servidor...`);
    }
  }

  const server = app.listen(env.PORT, () => {
    console.log(`\n🏥 ========================================================`);
    console.log(`🚀 ConformIA Backend API ativa e pronta para auditorias!`);
    console.log(`📡 URL: http://localhost:${env.PORT}`);
    console.log(`🩺 Healthcheck: http://localhost:${env.PORT}/health`);
    console.log(`🔒 API Base: http://localhost:${env.PORT}${env.API_PREFIX}`);
    console.log(`🧠 AI Provider: ${env.AI_PROVIDER}`);
    console.log(`========================================================\n`);

    // Inicia o agendador contínuo de auditorias (cron)
    if (env.NODE_ENV !== 'test') {
      AuditSchedulerService.init().catch((err) => {
        console.warn(`[Bootstrap] Falha ao iniciar AuditSchedulerService: ${err.message}`);
      });
    }
  });

  // INF-03: Graceful Shutdown Coordenado do Servidor HTTP, Agendador e Conexões de Banco
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Sinal ${signal} recebido. Encerrando servidor HTTP gracefully...`);

    const forceExitTimeout = setTimeout(() => {
      console.error('⚠️ Timeout de encerramento excedido (10s). Forçando finalização do processo.');
      process.exit(1);
    }, 10000);
    forceExitTimeout.unref();

    try {
      await new Promise<void>((resolve) => {
        server.close((err) => {
          if (err) console.warn('Aviso ao fechar servidor HTTP:', err.message);
          console.log('✅ Servidor HTTP finalizado.');
          resolve();
        });
      });

      const { prisma } = await import('./config/prisma.js');
      if (typeof (prisma as any).$disconnect === 'function') {
        await prisma.$disconnect();
        console.log('✅ Conexão com MongoDB finalizada.');
      }

      clearTimeout(forceExitTimeout);
      console.log('🚀 Finalização graciosa concluída com sucesso.');
      process.exit(0);
    } catch (err: any) {
      clearTimeout(forceExitTimeout);
      console.error('Erro durante shutdown:', err.message);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('❌ Falha fatal ao iniciar ConformIA Backend:', err);
  process.exit(1);
});

