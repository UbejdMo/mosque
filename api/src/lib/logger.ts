import { pino } from 'pino';
import { env, isProduction } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Never let a PIN, a session cookie or an ID-photo URL reach the log stream.
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.pin',
      '*.pinHash',
      '*.password',
      '*.claimCode',
    ],
    censor: '[redacted]',
  },
  ...(isProduction ? {} : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});
