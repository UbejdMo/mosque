import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './http/middleware/error-handler.js';
import { healthRouter } from './routes/health.js';

/**
 * The API is a pure JSON service — no templates, no static files, no
 * server-rendered anything (SPEC §3). The web SPA and the future Expo client
 * are both just clients of this.
 */
export function createApp(): Express {
  const app = express();

  // Behind Railway/Render's proxy; needed for correct client IPs in the audit
  // log and for rate limiting to key on the right address.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.WEB_ORIGIN,
      // Sessions ride in an httpOnly cookie (SPEC §7).
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  if (!isTest) {
    app.use(pinoHttp({ logger }));
  }

  app.use('/api', healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
