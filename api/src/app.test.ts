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

  it('does not reveal which routes exist to a signed-out caller', async () => {
    // Everything under /api past the auth routes sits behind `authenticate`,
    // so an unknown path is refused before it can 404. Deliberate: the route
    // list is not public.
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('still uses the standard error envelope', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.body).toEqual({
      error: { code: 'unauthenticated', message: expect.any(String) },
    });
  });
});
