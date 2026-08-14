import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireScope } from '../http/middleware/authenticate.js';
import { parseBody } from '../http/validate.js';
import { clearSessionCookie, setSessionCookie } from '../lib/session.js';
import { login } from '../services/auth.js';

export const authRouter: Router = Router();

const loginSchema = z.object({
  // Kept loose on purpose: Kosovo numbers get written as 044..., +38344...,
  // and 0038344... and the collector should not have to care which.
  phone: z.string().trim().min(6).max(32),
  pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
});

authRouter.post('/auth/login', async (req, res) => {
  const { phone, pin } = parseBody(loginSchema, req);
  const result = await login(phone, pin);

  setSessionCookie(res, result.token);
  // The token is never returned in the body — it lives in the httpOnly cookie
  // so no script can read it.
  res.json({ user: result.user });
});

authRouter.post('/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

/** Who am I — the SPA calls this on boot to decide what to render. */
authRouter.get('/auth/me', authenticate, (req, res) => {
  const scope = requireScope(req);
  res.json({
    user: {
      id: scope.actor.userId,
      role: scope.actor.role,
      mosqueId: scope.mosqueId,
      householdId: scope.actor.householdId,
    },
  });
});
