import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';

export function createApp(): Express {
  const app = express();

  // Configura proxy reverso seguro (Nginx / Docker)
  app.set('trust proxy', 1);

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

  // 2. CORS Seguro com restrição estrita de origens permitidas (SEC-06)
  const allowedOrigins = (env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        // Requisições diretas sem origin (ex: ferramentas internas, curl ou testes unitários sem cabeçalho origin)
        if (!origin) {
          return callback(null, true);
        }

        // Em desenvolvimento ou teste, permite localhost
        if (env.NODE_ENV !== 'production') {
          if (
            origin.startsWith('http://localhost:') ||
            origin.startsWith('http://127.0.0.1:') ||
            allowedOrigins.includes(origin)
          ) {
            return callback(null, true);
          }
        }

        // Em produção, valida estritamente contra as origens configuradas (proibindo wildcard com credentials)
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        return callback(new Error(`Acesso bloqueado pela política de CORS: origem ${origin} não autorizada.`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-refresh-token', 'X-Requested-With', 'x-requested-with'],
    })
  );

  // 3. Parsers com limites estritos anti-DoS (T09): 100kb global
  // Exclui a rota de upload de normas (/scraped-pages/upload), que possui parser dedicado de 20mb (T25)
  app.use((req, res, next) => {
    const isUploadRoute = req.originalUrl?.includes('/scraped-pages/upload') || req.path?.includes('/scraped-pages/upload');
    if (isUploadRoute) {
      return next();
    }
    express.json({ limit: '100kb' })(req, res, next);
  });
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

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

