import { Router } from 'express';

export const healthRouter: Router = Router();

/** Liveness only. A database-backed readiness check lands with the db layer. */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});
