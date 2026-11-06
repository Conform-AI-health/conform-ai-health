import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';

export function createApp(): Express {
  const app = express();

  // 1. Hardening com Helmet & Content Security Policy
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'https:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // 2. CORS
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // 3. Parsers com limites para evitar DoS por payload massivo
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // 4. Healthcheck simples
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
  });

  // 5. Rotas principais da API REST
  app.use(env.API_PREFIX, routes);

  // 6. Tratamento de rotas inexistentes (404)
  app.use((_req, res) => {
    res.status(404).json({
      error: 'Endpoint não encontrado.',
      code: 'ROUTE_NOT_FOUND',
    });
  });

  // 7. Middleware centralizado de tratamento de erros
  app.use(errorHandler);

  return app;
}

