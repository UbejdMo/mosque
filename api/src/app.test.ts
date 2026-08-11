import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

describe('app', () => {
  const app = createApp();

  it('reports health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns the standard error envelope for unknown routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
