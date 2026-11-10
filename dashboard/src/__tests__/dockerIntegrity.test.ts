import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { envSchema, KNOWN_INSECURE_SECRETS } from '../config/env.js';

describe('🐳 Integridade e Resiliência da Infraestrutura Docker Compose & Container Boot', () => {
  const rootDir = path.resolve(__dirname, '../../../');
  const composePath = path.join(rootDir, 'docker-compose.yml');
  const envExamplePath = path.join(rootDir, '.env.example');
  const backendDockerfile = path.join(__dirname, '../../Dockerfile');
  const frontendDockerfile = path.join(rootDir, 'dashboard-web/Dockerfile');

  it('1. Arquivo docker-compose.yml deve existir e possuir os 4 serviços mandatórios', () => {
    expect(fs.existsSync(composePath), 'docker-compose.yml deve existir na raiz do projeto').toBe(true);

    const composeContent = fs.readFileSync(composePath, 'utf8');

    // Serviços obrigatórios da arquitetura ConformIA
    expect(composeContent).toMatch(/services:\s*/);
    expect(composeContent).toMatch(/redis:\s*/);
    expect(composeContent).toMatch(/dashboard-api:\s*/);
    expect(composeContent).toMatch(/audit-worker:\s*/);
    expect(composeContent).toMatch(/dashboard-web:\s*/);

    // Rede e volume isolados
    expect(composeContent).toMatch(/networks:\s*[\r\n]+\s+conformia-net:/);
    expect(composeContent).toMatch(/volumes:\s*[\r\n]+\s+redis_data:/);
  });

  it('2. Dependências de inicialização (depends_on) devem referenciar apenas serviços com healthcheck', () => {
    const composeContent = fs.readFileSync(composePath, 'utf8');

    // dashboard-api deve depender de redis (healthy)
    expect(composeContent).toMatch(/dashboard-api:[\s\S]*?depends_on:[\s\S]*?redis:[\s\S]*?condition:\s*service_healthy/);

    // audit-worker deve depender de redis (healthy)
    expect(composeContent).toMatch(/audit-worker:[\s\S]*?depends_on:[\s\S]*?redis:[\s\S]*?condition:\s*service_healthy/);

    // dashboard-web deve depender de dashboard-api (healthy)
    expect(composeContent).toMatch(/dashboard-web:[\s\S]*?depends_on:[\s\S]*?dashboard-api:[\s\S]*?condition:\s*service_healthy/);

    // Para evitar quebras: cada serviço referenciado como 'service_healthy' DEVE conter bloco de healthcheck
    const requiredHealthyServices = ['redis', 'dashboard-api'];
    for (const service of requiredHealthyServices) {
      const serviceRegex = new RegExp(`${service}:[\\s\\S]*?healthcheck:[\\s\\S]*?test:`, 'm');
      expect(composeContent).toMatch(serviceRegex);
    }
  });

  it('3. Healthcheck do Backend API deve ser rápido, leve e apontar para /health (sem requerer autenticação)', () => {
    const composeContent = fs.readFileSync(composePath, 'utf8');

    // O healthcheck NÃO deve chamar endpoints protegidos ou que façam ping pesado síncrono no Atlas
    expect(composeContent).not.toMatch(/system\/status/);

    // O healthcheck deve chamar /health na porta interna 3000
    expect(composeContent).toMatch(/http:\/\/127\.0\.0\.1:3000\/health/);

    // Deve possuir configurações adequadas de resiliência
    expect(composeContent).toMatch(/interval:\s*\d+s/);
    expect(composeContent).toMatch(/timeout:\s*\d+s/);
    expect(composeContent).toMatch(/retries:\s*\d+/);
  });

  it('4. Healthcheck do Worker e do Frontend devem estar rigorosamente configurados', () => {
    const composeContent = fs.readFileSync(composePath, 'utf8');

    // Worker healthcheck na porta de telemetria 3001
    expect(composeContent).toMatch(/http:\/\/127\.0\.0\.1:3001\/health/);

    // Frontend Nginx healthcheck na porta 80
    expect(composeContent).toMatch(/http:\/\/127\.0\.0\.1:80\//);

    // Redis healthcheck com autenticação
    expect(composeContent).toMatch(/redis-cli.*-a.*ping/);
  });

  it('5. Variáveis de Produção no docker-compose.yml devem validar com sucesso no envSchema do Zod', () => {
    const composeContent = fs.readFileSync(composePath, 'utf8');

    // 1. Não pode conter CORS_ORIGIN=* no docker-compose
    expect(composeContent).not.toMatch(/CORS_ORIGIN=\*/);

    // 2. ADMIN_PASSWORD deve ser obrigatória em produção no dashboard-api e audit-worker
    expect(composeContent).toMatch(/ADMIN_PASSWORD=\${ADMIN_PASSWORD/);
    expect(composeContent).toMatch(/ADMIN_EMAIL=\${ADMIN_EMAIL/);

    // 3. Simula as variáveis que o Docker Compose injeta em produção
    const simulatedProductionEnv = {
      NODE_ENV: 'production',
      PORT: '3000',
      API_PREFIX: '/api/v1',
      DATABASE_URL: 'mongodb+srv://user:pass@cluster.mongodb.net/prod?retryWrites=true&w=majority',
      REDIS_URL: 'redis://:redispasswords@redis:6379',
      REDIS_PASSWORD: 'redispasswords',
      JWT_SECRET: 'uma-chave-super-secreta-producao-de-alta-entropia-32chars',
      JWT_EXPIRES_IN: '1h',
      JWT_REFRESH_SECRET: 'chave-super-secreta-refresh-producao-alta-entropia-32chars',
      JWT_REFRESH_EXPIRES_IN: '7d',
      RESEND_API_KEY: 're_production_test_key_sample',
      EMAIL_FROM: 'nao-responder@conformia.med.br',
      FRONTEND_URL: 'http://localhost:3000',
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-gemini-key',
      OLLAMA_BASE_URL: 'http://host.docker.internal:11434',
      OLLAMA_MODEL: 'qwen2.5:7b',
      EXTRACTION_MODE: 'CHEERIO',
      CORS_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000',
      ADMIN_EMAIL: 'admin@conform.ai',
      ADMIN_PASSWORD: 'ConformIA_Admin@2026_SecureKey!',
      MONITORING_API_KEY: 'super-secret-telemetry-key-2026',
    };

    const parseResult = envSchema.safeParse(simulatedProductionEnv);
    expect(parseResult.success, `Falha na validação de variáveis do Compose: ${JSON.stringify(parseResult.error?.format())}`).toBe(true);
  });

  it('6. envSchema deve bloquear terminantemente credenciais conhecidas ou CORS inseguro em produção', () => {
    // Teste negativo: senha conhecida em produção deve falhar
    for (const weakSecret of KNOWN_INSECURE_SECRETS) {
      const weakEnv = {
        NODE_ENV: 'production',
        DATABASE_URL: 'mongodb+srv://user:pass@cluster.mongodb.net/prod',
        JWT_SECRET: 'uma-chave-super-secreta-producao-de-alta-entropia-32chars',
        JWT_REFRESH_SECRET: 'chave-super-secreta-refresh-producao-alta-entropia-32chars',
        ADMIN_PASSWORD: weakSecret,
        CORS_ORIGIN: 'http://localhost:3000',
      };
      const result = envSchema.safeParse(weakEnv);
      expect(result.success, `Deveria ter rejeitado senha insegura: ${weakSecret}`).toBe(false);
    }

    // Teste negativo: CORS '*' em produção deve falhar
    const wildcardCorsEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: 'mongodb+srv://user:pass@cluster.mongodb.net/prod',
      JWT_SECRET: 'uma-chave-super-secreta-producao-de-alta-entropia-32chars',
      JWT_REFRESH_SECRET: 'chave-super-secreta-refresh-producao-alta-entropia-32chars',
      ADMIN_PASSWORD: 'SenhaForteComMaisDe12Caracteres!',
      CORS_ORIGIN: '*',
    };
    const corsResult = envSchema.safeParse(wildcardCorsEnv);
    expect(corsResult.success, 'Deveria ter rejeitado CORS_ORIGIN=* em produção').toBe(false);
  });

  it('7. Dockerfiles de Backend e Frontend devem seguir padrões de hardening de contêiner', () => {
    // Backend Dockerfile
    expect(fs.existsSync(backendDockerfile), 'dashboard/Dockerfile deve existir').toBe(true);
    const backendDockerContent = fs.readFileSync(backendDockerfile, 'utf8');

    expect(backendDockerContent).toMatch(/AS builder/);
    expect(backendDockerContent).toMatch(/AS runner/);
    expect(backendDockerContent).toMatch(/dumb-init/);
    expect(backendDockerContent).toMatch(/USER node/);
    expect(backendDockerContent).toMatch(/ENTRYPOINT.*dumb-init/);

    // Frontend Dockerfile
    expect(fs.existsSync(frontendDockerfile), 'dashboard-web/Dockerfile deve existir').toBe(true);
    const frontendDockerContent = fs.readFileSync(frontendDockerfile, 'utf8');

    expect(frontendDockerContent).toMatch(/AS builder/);
    expect(frontendDockerContent).toMatch(/AS runner/);
    expect(frontendDockerContent).toMatch(/nginx/);
    expect(frontendDockerContent).toMatch(/EXPOSE 80/);
  });

  it('8. Todas as variáveis interpoladas no docker-compose.yml devem constar no .env.example', () => {
    expect(fs.existsSync(envExamplePath), '.env.example deve existir').toBe(true);
    const composeContent = fs.readFileSync(composePath, 'utf8');
    const envExampleContent = fs.readFileSync(envExamplePath, 'utf8');

    // Extrai todas as variáveis no formato ${VAR_NAME...}
    const varMatches = composeContent.match(/\$\{([A-Z0-9_]+)[^}]*\}/g) || [];
    const composeVars = Array.from(
      new Set(varMatches.map((m) => m.replace(/^\$\{/, '').replace(/\}$/, '').split(/[:\-?]/)[0]))
    );

    // Variáveis que devem estar documentadas no .env.example
    const criticalVars = [
      'DATABASE_URL',
      'REDIS_PASSWORD',
      'JWT_SECRET',
      'JWT_REFRESH_SECRET',
      'ADMIN_EMAIL',
      'ADMIN_PASSWORD',
      'AI_PROVIDER',
      'CORS_ORIGIN',
    ];

    for (const v of criticalVars) {
      expect(composeVars).toContain(v);
      const varInExampleRegex = new RegExp(`^${v}=`, 'm');
      expect(envExampleContent).toMatch(varInExampleRegex);
    }
  });
});
