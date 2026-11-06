import { createApp } from './app.js';
import { env } from './config/env.js';
import { runAutoMigrateAndSeed } from './shared/autoMigrate.js';

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
  });

  const shutdown = async () => {
    console.log('\n🛑 Encerrando servidor HTTP gracefully...');
    server.close(() => {
      console.log('✅ Servidor HTTP finalizado.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('❌ Falha fatal ao iniciar ConformIA Backend:', err);
  process.exit(1);
});

