import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './http/middleware/error-handler.js';
import { authenticate } from './http/middleware/authenticate.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { householdsRouter } from './routes/households.js';
import { personsRouter } from './routes/persons.js';
import { paymentsRouter, ratesRouter } from './routes/payments.js';

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

  // Public: liveness, and the login/logout pair itself.
  app.use('/api', healthRouter);
  app.use('/api', authRouter);

  /**
   * Everything below this line requires a session. Applied once, here, rather
   * than per router: a route added later is protected by default, and a
   * request pays for exactly one session lookup instead of one per router it
   * falls through.
   *
   * A side effect is that an unknown `/api/...` path answers 401 rather than
   * 404 when signed out, which also keeps the route list to ourselves.
   */
  app.use('/api', authenticate);

  app.use('/api', householdsRouter);
  app.use('/api', personsRouter);
  app.use('/api', paymentsRouter);
  app.use('/api', ratesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
