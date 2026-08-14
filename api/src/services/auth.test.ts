import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { closeTestDb, resetTestDb, testDb } from '../test/db.js';
import { CURRENT_YEAR, addHousehold, seedMosque } from '../test/factories.js';
import { users } from '../db/schema/index.js';
import { hashPin } from '../lib/pin.js';
import { createApp } from '../app.js';
import { MAX_LOGIN_ATTEMPTS, login } from './auth.js';
import { SESSION_COOKIE } from '../lib/session.js';

const app = createApp();
const PIN = '482913';

beforeEach(async () => {
  await resetTestDb();
});
afterAll(async () => {
  await closeTestDb();
});

async function seedUser(options: {
  phone: string;
  role?: 'imam' | 'collector' | 'member';
  status?: 'pending' | 'active' | 'rejected' | 'disabled';
  householdId?: string;
  mosqueId: string;
}): Promise<string> {
  const [row] = await testDb
    .insert(users)
    .values({
      mosqueId: options.mosqueId,
      phone: options.phone,
      pinHash: await hashPin(PIN),
      role: options.role ?? 'collector',
      status: options.status ?? 'active',
      householdId: options.householdId ?? null,
    })
    .returning({ id: users.id });
  if (!row) throw new Error('Failed to seed user');
  return row.id;
}

describe('login (SPEC §7)', () => {
  it('accepts the right phone and PIN', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const userId = await seedUser({ phone: '+38344111222', mosqueId: mosque.mosqueId });

    const result = await login('+38344111222', PIN);
    expect(result.user.id).toBe(userId);
    expect(result.user.role).toBe('collector');
    expect(result.token).toBeTruthy();
  });

  it('rejects a wrong PIN without revealing whether the phone exists', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    await seedUser({ phone: '+38344111222', mosqueId: mosque.mosqueId });

    // Identical message for a wrong PIN and an unknown number.
    await expect(login('+38344111222', '000001')).rejects.toThrow(/invalid phone number or pin/i);
    await expect(login('+38344999999', PIN)).rejects.toThrow(/invalid phone number or pin/i);
  });

  it('locks the account after five failed attempts, then refuses even the right PIN', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    await seedUser({ phone: '+38344111222', mosqueId: mosque.mosqueId });

    for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS; attempt++) {
      await expect(login('+38344111222', '000001')).rejects.toThrow(/invalid/i);
    }

    await expect(login('+38344111222', PIN)).rejects.toThrow(/too many attempts/i);

    const [row] = await testDb.select().from(users).where(eq(users.phone, '+38344111222'));
    expect(row?.failedLoginAttempts).toBe(MAX_LOGIN_ATTEMPTS);
    expect(row?.lockedUntil).toBeInstanceOf(Date);
  });

  it('a successful login clears the failure count', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    await seedUser({ phone: '+38344111222', mosqueId: mosque.mosqueId });

    await expect(login('+38344111222', '000001')).rejects.toThrow();
    await login('+38344111222', PIN);

    const [row] = await testDb.select().from(users).where(eq(users.phone, '+38344111222'));
    expect(row?.failedLoginAttempts).toBe(0);
    expect(row?.lockedUntil).toBeNull();
    expect(row?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('tells a pending member their registration is still waiting', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const household = await addHousehold(mosque);
    await seedUser({
      phone: '+38344333444',
      role: 'member',
      status: 'pending',
      householdId: household,
      mosqueId: mosque.mosqueId,
    });

    await expect(login('+38344333444', PIN)).rejects.toThrow(/waiting for approval/i);
  });

  it('refuses a disabled account', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    await seedUser({ phone: '+38344555666', status: 'disabled', mosqueId: mosque.mosqueId });
    await expect(login('+38344555666', PIN)).rejects.toThrow(/not active/i);
  });
});

describe('session cookie', () => {
  it('logs in, reads /auth/me with the cookie, then logs out', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const userId = await seedUser({ phone: '+38344777888', mosqueId: mosque.mosqueId });
    const agent = request.agent(app);

    const loginRes = await agent
      .post('/api/auth/login')
      .send({ phone: '+38344777888', pin: PIN });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.id).toBe(userId);

    const cookie = loginRes.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain(SESSION_COOKIE);
    // The token must not be reachable from JavaScript.
    expect(cookie).toContain('HttpOnly');
    // ...nor returned in the body for a client to store.
    expect(JSON.stringify(loginRes.body)).not.toContain('eyJ');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.mosqueId).toBe(mosque.mosqueId);

    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('refuses a request with no cookie, and one with a forged cookie', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);

    const forged = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=not.a.real.token`);
    expect(forged.status).toBe(401);
  });

  it('stops working the moment the account is disabled, without waiting for expiry', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const userId = await seedUser({ phone: '+38344777999', mosqueId: mosque.mosqueId });
    const agent = request.agent(app);

    await agent.post('/api/auth/login').send({ phone: '+38344777999', pin: PIN });
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    // Role and status are re-read per request, so revocation is immediate.
    await testDb.update(users).set({ status: 'disabled' }).where(eq(users.id, userId));
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects a malformed login body before it reaches the data layer', async () => {
    const res = await request(app).post('/api/auth/login').send({ phone: '+38344777888', pin: '12' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});
