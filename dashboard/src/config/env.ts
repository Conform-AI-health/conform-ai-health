import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const KNOWN_INSECURE_SECRETS = [
  'conformia-super-secret-jwt-key-2026',
  'conformia-refresh-secret-jwt-key-2026',
  'secret',
  'jwt_secret',
  'password',
  '12345678',
  'admin123456',
  'admin',
  'administrator',
  'conformia123',
  'DefinaSuaSenhaSeguraAqui123456789!',
];

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3000),
    API_PREFIX: z.string().default('/api/v1'),
    DATABASE_URL:
      process.env.NODE_ENV === 'test'
        ? z.string().default('mongodb://localhost:27017/conformia_test')
        : z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    REDIS_PASSWORD: z.string().optional().default(''),
    JWT_SECRET:
      process.env.NODE_ENV === 'test'
        ? z.string().default('conformia-super-secret-jwt-key-2026-test-environment-32chars')
        : z.string().min(16, 'JWT_SECRET must have at least 16 characters'),
    JWT_EXPIRES_IN: z.string().default('1h'),
    JWT_REFRESH_SECRET:
      process.env.NODE_ENV === 'test'
        ? z.string().default('conformia-refresh-secret-jwt-key-2026-test-environment-32chars')
        : z.string().min(16, 'JWT_REFRESH_SECRET must have at least 16 characters'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    RESEND_API_KEY: z.string().optional().default(''),
    EMAIL_FROM: z.string().default(process.env.EMAIL_FROM || process.env.RESEND_FROM || 'Conform.AI <onboarding@resend.dev>'),
    FRONTEND_URL: z.string().default('http://localhost:5173'),
    AI_PROVIDER: z.enum(['gemini', 'ollama', 'heuristic']).default('gemini'),
    GEMINI_API_KEY: z.string().optional().default(''),
    OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
    OLLAMA_MODEL: z.string().default('qwen2.5:7b'),
    GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
    EXTRACTION_MODE: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL']).default('CHEERIO'),
    FIRECRAWL_API_KEY: z.string().optional().default(''),
    FIRECRAWL_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    FIRECRAWL_WAIT_FOR_MS: z.coerce.number().int().nonnegative().default(1500),
    CRAWL_MAX_LINKS_PER_PAGE: z.coerce.number().int().positive().default(50),
    CRAWL_BATCH_SIZE: z.coerce.number().int().positive().default(4),
    CRAWL_MAX_PAGES: z.coerce.number().int().positive().default(100),
    MCP_SERVER_URL: z.string().optional().default('http://localhost:8080/mcp'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    MONITORING_API_KEY: z.string().optional().default(''),
    ADMIN_EMAIL: z.string().email().optional().default('admin@conform.ai'),
    ADMIN_PASSWORD: z.string().optional().default(''),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      // 1. Secrets criptográficos de alta entropia
      if (data.JWT_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Em ambiente de produção, JWT_SECRET deve ter no mínimo 32 caracteres criptográficos.',
          path: ['JWT_SECRET'],
        });
      }
      if (KNOWN_INSECURE_SECRETS.includes(data.JWT_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Em produção é terminantemente proibido utilizar JWT_SECRET padrão ou conhecido.',
          path: ['JWT_SECRET'],
        });
      }

      if (data.JWT_REFRESH_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Em ambiente de produção, JWT_REFRESH_SECRET deve ter no mínimo 32 caracteres criptográficos.',
          path: ['JWT_REFRESH_SECRET'],
        });
      }
      if (KNOWN_INSECURE_SECRETS.includes(data.JWT_REFRESH_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Em produção é terminantemente proibido utilizar JWT_REFRESH_SECRET padrão ou conhecido.',
          path: ['JWT_REFRESH_SECRET'],
        });
      }

      // 2. Senha de Administrador em Produção (T01)
      if (!data.ADMIN_PASSWORD || data.ADMIN_PASSWORD.length < 12) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Em produção, ADMIN_PASSWORD é obrigatória e deve possuir no mínimo 12 caracteres.',
          path: ['ADMIN_PASSWORD'],
        });
      }
      if (data.ADMIN_PASSWORD && KNOWN_INSECURE_SECRETS.includes(data.ADMIN_PASSWORD)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Em produção é proibido utilizar ADMIN_PASSWORD padrão ou previsível (ex: admin123456).',
          path: ['ADMIN_PASSWORD'],
        });
      }

      // 3. Proibição de CORS wildcard com credenciais
      if (data.CORS_ORIGIN === '*' || !data.CORS_ORIGIN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Em produção, CORS_ORIGIN deve conter origens explícitas e não pode ser "*".',
          path: ['CORS_ORIGIN'],
        });
      }

      // 4. Proteção Mandatória de Métricas Operacionais em Produção (T02)
      if (!data.MONITORING_API_KEY || data.MONITORING_API_KEY.length < 16) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Em produção, MONITORING_API_KEY é obrigatória e deve possuir no mínimo 16 caracteres criptográficos.',
          path: ['MONITORING_API_KEY'],
        });
      }
      if (data.MONITORING_API_KEY && KNOWN_INSECURE_SECRETS.includes(data.MONITORING_API_KEY)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Em produção é proibido utilizar MONITORING_API_KEY padrão ou previsível.',
          path: ['MONITORING_API_KEY'],
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Configuração inválida de variáveis de ambiente:', parsed.error.format());
  throw new Error('Variáveis de ambiente inválidas. Verifique seu arquivo .env');
}

export const env = parsed.data;
export { envSchema, KNOWN_INSECURE_SECRETS };

