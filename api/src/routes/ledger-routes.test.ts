import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import type TestAgent from 'supertest/lib/agent.js';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../test/db.js';
import { CURRENT_YEAR, addHousehold, addPerson, seedMosque, type Scenario } from '../test/factories.js';
import { users } from '../db/schema/index.js';
import { hashPin } from '../lib/pin.js';
import { createApp } from '../app.js';

const app = createApp();
const PIN = '482913';
let phoneSeq = 0;

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetTestDb();
  phoneSeq = 0;
});
afterAll(async () => {
  await closeTestDb();
});

/** Signs in over HTTP, so the tests exercise the real cookie path. */
async function signIn(
  scenario: Scenario,
  role: 'imam' | 'collector' | 'member',
  householdId?: string,
): Promise<TestAgent> {
  const phone = `+3834410${String(phoneSeq++).padStart(4, '0')}`;
  await testDb.insert(users).values({
    mosqueId: scenario.mosqueId,
    phone,
    pinHash: await hashPin(PIN),
    role,
    status: 'active',
    householdId: householdId ?? null,
  });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ phone, pin: PIN });
  expect(res.status).toBe(200);
  return agent;
}

describe('household routes', () => {
  it('lists households sorted by what they owe', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const small = await addHousehold(mosque);
    await addPerson(mosque, small, { joinedYear: start });
    const large = await addHousehold(mosque);
    for (let i = 0; i < 4; i++) await addPerson(mosque, large, { joinedYear: start });

    const agent = await signIn(mosque, 'collector');
    const res = await agent.get('/api/households');

    expect(res.status).toBe(200);
    expect(res.body.households).toHaveLength(2);
    // Biggest debt first — the order the collector walks in.
    expect(res.body.households[0].id).toBe(large);
    expect(res.body.households[0].balanceCents).toBe(4 * 4 * 500);
    expect(res.body.households[1].id).toBe(small);
  });

  it('finds a household by name despite Albanian diacritics', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const household = await addHousehold(mosque);
    // Seeded directly so the stored spelling keeps its diacritic: `Bërisha`
    // must be found by typing `Berisha`, and vice versa.
    await testDb.execute(sql`
      INSERT INTO persons (mosque_id, household_id, first_name, father_name, last_name, joined_year)
      VALUES (${mosque.mosqueId}, ${household}, 'Ismet', 'Ramadan', 'Bërisha', ${CURRENT_YEAR - 1})
    `);

    const agent = await signIn(mosque, 'collector');

    const plain = await agent.get('/api/households').query({ search: 'Berisha' });
    expect(plain.body.households).toHaveLength(1);

    const accented = await agent.get('/api/households').query({ search: 'bërisha' });
    expect(accented.body.households).toHaveLength(1);

    const miss = await agent.get('/api/households').query({ search: 'Krasniqi' });
    expect(miss.body.households).toHaveLength(0);
  });

  it('returns the year grid and payment history for one household', async () => {
    const start = CURRENT_YEAR - 2;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start, isHead: true });

    const agent = await signIn(mosque, 'collector');
    const res = await agent.get(`/api/households/${household}`);

    expect(res.status).toBe(200);
    expect(res.body.years).toHaveLength(3);
    expect(res.body.years[0]).toMatchObject({
      year: start,
      liablePersonCount: 1,
      obligationCents: 500,
      status: 'unpaid',
    });
    expect(res.body.household.headName).toBe('Ismet Ramadan Krasniqi');
    expect(res.body.payments).toEqual([]);
  });

  it('a member reads only their own household over HTTP', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const mine = await addHousehold(mosque);
    const neighbour = await addHousehold(mosque);
    await addPerson(mosque, neighbour, { joinedYear: CURRENT_YEAR - 1 });

    const agent = await signIn(mosque, 'member', mine);

    const list = await agent.get('/api/households');
    expect(list.body.households).toHaveLength(1);
    expect(list.body.households[0].id).toBe(mine);

    // The neighbour is in the same mosque; only the member rule hides them.
    expect((await agent.get(`/api/households/${neighbour}`)).status).toBe(404);
    expect((await agent.get(`/api/households/${mine}`)).status).toBe(200);
  });

  it('a member cannot create or change anything', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const mine = await addHousehold(mosque);
    const agent = await signIn(mosque, 'member', mine);

    expect((await agent.post('/api/households').send({})).status).toBe(403);
    expect((await agent.patch(`/api/households/${mine}`).send({ notes: 'x' })).status).toBe(403);
    expect((await agent.delete(`/api/households/${mine}`)).status).toBe(403);
  });

  it('requires a session for every ledger route', async () => {
    const paths = ['/api/households', '/api/rates'];
    for (const path of paths) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });
});

describe('person and life-event routes', () => {
  it('records a birth through the API', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start, isHead: true });
    const agent = await signIn(mosque, 'collector');

    const res = await agent.post(`/api/households/${household}/persons/birth`).send({
      firstName: 'Arta',
      fatherName: 'Ismet',
      lastName: 'Krasniqi',
      birthYear: CURRENT_YEAR,
    });

    expect(res.status).toBe(201);
    expect(res.body.person.entryReason).toBe('birth');

    const detail = await agent.get(`/api/households/${household}`);
    const thisYear = detail.body.years.find((y: { year: number }) => y.year === CURRENT_YEAR);
    expect(thisYear.liablePersonCount).toBe(2);
  });

  it('emigration leaves the balance untouched', async () => {
    const start = CURRENT_YEAR - 2;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(mosque);
    const personId = await addPerson(mosque, household, { joinedYear: start });
    const agent = await signIn(mosque, 'collector');

    const before = (await agent.get(`/api/households/${household}`)).body.household.balanceCents;
    const res = await agent
      .post(`/api/persons/${personId}/emigration`)
      .send({ livesAbroad: true });

    expect(res.status).toBe(200);
    expect(res.body.person.livesAbroad).toBe(true);
    expect(res.body.person.leftYear).toBeNull();

    const after = (await agent.get(`/api/households/${household}`)).body.household.balanceCents;
    expect(after).toBe(before);
  });

  it('rejects a malformed body before it reaches the ledger', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const household = await addHousehold(mosque);
    const agent = await signIn(mosque, 'collector');

    // fatherName is required — never optional (SPEC §4.1).
    const res = await agent
      .post(`/api/households/${household}/persons/birth`)
      .send({ firstName: 'Arta', lastName: 'Krasniqi', birthYear: CURRENT_YEAR });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});

describe('payment and rate routes', () => {
  it('previews then records a payment, and reports a replay', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });
    const agent = await signIn(mosque, 'collector');

    const preview = await agent
      .post('/api/payments/preview')
      .send({ householdId: household, totalCents: 1000 });
    expect(preview.status).toBe(200);
    expect(preview.body.allocations).toEqual([
      { year: start, amountCents: 500 },
      { year: start + 1, amountCents: 500 },
    ]);

    const clientUuid = crypto.randomUUID();
    const body = {
      householdId: household,
      totalCents: 1000,
      paidAt: `${CURRENT_YEAR}-04-02`,
      receiptNumber: 'R-2001',
      clientUuid,
    };

    const created = await agent.post('/api/payments').send(body);
    expect(created.status).toBe(201);
    expect(created.body.replayed).toBe(false);
    expect(created.body.payment.allocations).toHaveLength(2);

    // The outbox retries: same result, no new payment, 200 not 201.
    const replay = await agent.post('/api/payments').send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.payment.id).toBe(created.body.payment.id);

    const detail = await agent.get(`/api/households/${household}`);
    expect(detail.body.payments).toHaveLength(1);
    expect(detail.body.household.balanceCents).toBe(1000);
  });

  it('lets the imam set a rate and refuses the collector', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const imam = await signIn(mosque, 'imam');
    const collector = await signIn(mosque, 'collector');

    expect((await imam.put(`/api/rates/${CURRENT_YEAR}`).send({ amountCents: 600 })).status).toBe(
      200,
    );
    expect(
      (await collector.put(`/api/rates/${CURRENT_YEAR}`).send({ amountCents: 700 })).status,
    ).toBe(403);

    const rates = await collector.get('/api/rates');
    expect(rates.body.rates.find((r: { year: number }) => r.year === CURRENT_YEAR).amountCents).toBe(
      600,
    );
  });

  it('a member cannot record a payment', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: CURRENT_YEAR - 1 });
    const agent = await signIn(mosque, 'member', household);

    const res = await agent.post('/api/payments').send({
      householdId: household,
      totalCents: 500,
      paidAt: `${CURRENT_YEAR}-04-02`,
      receiptNumber: 'R-2002',
      clientUuid: crypto.randomUUID(),
    });
    expect(res.status).toBe(403);
  });
});
