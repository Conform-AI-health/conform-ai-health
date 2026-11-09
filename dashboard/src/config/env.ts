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
    EMAIL_FROM: z.string().default('Conform.AI <onboarding@resend.dev>'),
    FRONTEND_URL: z.string().default('http://localhost:5173'),
    AI_PROVIDER: z.enum(['gemini', 'ollama', 'heuristic']).default('gemini'),
    GEMINI_API_KEY: z.string().optional().default(''),
    OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
    OLLAMA_MODEL: z.string().default('qwen2.5:7b'),
    EXTRACTION_MODE: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL']).default('CHEERIO'),
    FIRECRAWL_API_KEY: z.string().optional().default(''),
    MCP_SERVER_URL: z.string().optional().default('http://localhost:8080/mcp'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    MONITORING_API_KEY: z.string().optional().default(''),
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

      // 2. Proibição de CORS wildcard com credenciais
      if (data.CORS_ORIGIN === '*' || !data.CORS_ORIGIN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Em produção, CORS_ORIGIN deve conter origens explícitas e não pode ser "*".',
          path: ['CORS_ORIGIN'],
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
export { envSchema };

