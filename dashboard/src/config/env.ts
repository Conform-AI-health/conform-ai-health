import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default('/api/v1'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must have at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  AI_PROVIDER: z.enum(['gemini', 'ollama', 'heuristic']).default('gemini'),
  GEMINI_API_KEY: z.string().optional().default(''),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen2.5:7b'),
  EXTRACTION_MODE: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL']).default('CHEERIO'),
  FIRECRAWL_API_KEY: z.string().optional().default(''),
  MCP_SERVER_URL: z.string().optional().default('http://localhost:8080/mcp'),
  CORS_ORIGIN: z.string().default('*'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Configuração inválida de variáveis de ambiente:', parsed.error.format());
  throw new Error('Variáveis de ambiente inválidas. Verifique seu arquivo .env');
}

export const env = parsed.data;

