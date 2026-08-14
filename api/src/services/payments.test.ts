import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../test/db.js';
import { CURRENT_YEAR, addHousehold, addPerson, addSettlement, seedMosque } from '../test/factories.js';
import { auditLogs, collectionBatches, payments } from '../db/schema/index.js';
import { scopeFor, type Actor, type TenantScope } from '../db/tenancy.js';
import { balanceOf, yearRow } from '../test/ledger-queries.js';
import { previewAllocation, recordPayment } from './payments.js';
import * as ratesRepo from '../repositories/rates.js';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});
afterAll(async () => {
  await closeTestDb();
});

function scopeAs(role: Actor['role'], mosqueId: string, userId: string): TenantScope {
  return scopeFor({ userId, role, mosqueId, householdId: null });
}

const PAID_AT = `${CURRENT_YEAR}-03-15`;

describe('recording a payment (SPEC §5.5)', () => {
  it('writes payment, allocations, batch total and audit row in one go', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = scopeAs('collector', mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });

    const result = await recordPayment(scope, {
      householdId: household,
      totalCents: 1000,
      paidAt: PAID_AT,
      receiptNumber: 'R-1001',
      clientUuid: crypto.randomUUID(),
    });

    expect(result.replayed).toBe(false);
    // FIFO: the two oldest years, €5 each.
    expect(result.allocations).toEqual([
      { year: start, amountCents: 500 },
      { year: start + 1, amountCents: 500 },
    ]);

    const [batch] = await testDb
      .select()
      .from(collectionBatches)
      .where(eq(collectionBatches.id, result.batchId));
    expect(batch?.periodMonth).toBe(3);
    expect(batch?.grossCollectedCents).toBe(1000);
    expect(batch?.status).toBe('open');

    expect((await yearRow(household, start)).status).toBe('paid');
    expect((await balanceOf(household)).balanceCents).toBe(1000);

    const audit = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'payment.created'));
    expect(audit).toHaveLength(1);
  });

  it('a replayed sync creates nothing and moves no money', async () => {
    const start = CURRENT_YEAR - 2;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = scopeAs('collector', mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });

    const clientUuid = crypto.randomUUID();
    const input = {
      householdId: household,
      totalCents: 500,
      paidAt: PAID_AT,
      receiptNumber: 'R-1002',
      clientUuid,
    };

    const first = await recordPayment(scope, input);
    const balanceAfterFirst = (await balanceOf(household)).balanceCents;

    const replay = await recordPayment(scope, input);

    expect(replay.replayed).toBe(true);
    expect(replay.payment.id).toBe(first.payment.id);
    expect(replay.allocations).toEqual(first.allocations);
    expect((await balanceOf(household)).balanceCents).toBe(balanceAfterFirst);
    expect(await testDb.select().from(payments)).toHaveLength(1);

    // The batch total must not double-count either.
    const [batch] = await testDb
      .select()
      .from(collectionBatches)
      .where(eq(collectionBatches.id, first.batchId));
    expect(batch?.grossCollectedCents).toBe(500);

    // And no second audit row claiming a payment happened.
    const audit = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'payment.created'));
    expect(audit).toHaveLength(1);
  });

  it('honours a manual allocation instead of FIFO', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = scopeAs('collector', mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });

    await recordPayment(scope, {
      householdId: household,
      totalCents: 500,
      paidAt: PAID_AT,
      receiptNumber: 'R-1003',
      clientUuid: crypto.randomUUID(),
      allocations: [{ year: CURRENT_YEAR, amountCents: 500 }],
    });

    expect((await yearRow(household, CURRENT_YEAR)).status).toBe('paid');
    expect((await yearRow(household, start)).status).toBe('unpaid');
  });

  it('flags a duplicate receipt number without blocking the payment', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = scopeAs('collector', mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });

    const first = await recordPayment(scope, {
      householdId: household,
      totalCents: 500,
      paidAt: PAID_AT,
      receiptNumber: 'R-DUP',
      clientUuid: crypto.randomUUID(),
    });
    expect(first.duplicateReceipt).toBe(false);

    // Same receipt number, different payment: recorded, and flagged (SPEC §9).
    const second = await recordPayment(scope, {
      householdId: household,
      totalCents: 500,
      paidAt: PAID_AT,
      receiptNumber: 'R-DUP',
      clientUuid: crypto.randomUUID(),
    });
    expect(second.duplicateReceipt).toBe(true);
    expect(await testDb.select().from(payments)).toHaveLength(2);
  });

  it('refuses to allocate to a year that owes nothing', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = scopeAs('collector', mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });
    await addSettlement(mosque, household, CURRENT_YEAR);

    await expect(
      recordPayment(scope, {
        householdId: household,
        totalCents: 500,
        paidAt: PAID_AT,
        receiptNumber: 'R-1004',
        clientUuid: crypto.randomUUID(),
        allocations: [{ year: CURRENT_YEAR, amountCents: 500 }],
      }),
    ).rejects.toThrow(/nothing is owed/i);
  });

  it('refuses to over-allocate a year beyond what it owes', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = scopeAs('collector', mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });

    await expect(
      recordPayment(scope, {
        householdId: household,
        totalCents: 900,
        paidAt: PAID_AT,
        receiptNumber: 'R-1005',
        clientUuid: crypto.randomUUID(),
        allocations: [{ year: start, amountCents: 900 }],
      }),
    ).rejects.toThrow(/owes only/i);
  });

  it('rejects allocations that do not sum to the payment', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = scopeAs('collector', mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });

    await expect(
      recordPayment(scope, {
        householdId: household,
        totalCents: 1000,
        paidAt: PAID_AT,
        receiptNumber: 'R-1006',
        clientUuid: crypto.randomUUID(),
        allocations: [{ year: start, amountCents: 500 }],
      }),
    ).rejects.toThrow(/sum to/i);
  });

  it('leaves nothing behind when the payment is rejected', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = scopeAs('collector', mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });

    await expect(
      recordPayment(scope, {
        householdId: household,
        totalCents: 1000,
        paidAt: PAID_AT,
        receiptNumber: '',
        clientUuid: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/receipt number/i);

    expect(await testDb.select().from(payments)).toHaveLength(0);
    expect(await testDb.select().from(collectionBatches)).toHaveLength(0);
    expect(await testDb.select().from(auditLogs)).toHaveLength(0);
  });

  it('a member cannot record a payment', async () => {
    const start = CURRENT_YEAR - 2;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });
    const scope = scopeFor({
      userId: mosque.userId,
      role: 'member',
      mosqueId: mosque.mosqueId,
      householdId: household,
    });

    await expect(
      recordPayment(scope, {
        householdId: household,
        totalCents: 500,
        paidAt: PAID_AT,
        receiptNumber: 'R-1007',
        clientUuid: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/read-only/i);
  });

  it('previews the FIFO split without writing anything', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = scopeAs('collector', mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });

    const preview = await previewAllocation(scope, household, 1200);

    expect(preview.allocations).toEqual([
      { year: start, amountCents: 500 },
      { year: start + 1, amountCents: 500 },
      { year: start + 2, amountCents: 200 },
    ]);
    expect(preview.unallocatedCents).toBe(0);
    expect(await testDb.select().from(payments)).toHaveLength(0);
  });

  it('reports money it cannot place rather than inventing a year for it', async () => {
    const start = CURRENT_YEAR - 1;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = scopeAs('collector', mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });

    // Owes 2 years × €5 = €10; hands over €25.
    const preview = await previewAllocation(scope, household, 2500);
    expect(preview.unallocatedCents).toBe(1500);
  });
});

describe('rates (SPEC §4.2)', () => {
  it('lets the imam set a rate and audits the change', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const scope = scopeAs('imam', mosque.mosqueId, mosque.userId);

    await ratesRepo.setRate(scope, CURRENT_YEAR, 600);

    const rates = await ratesRepo.listByYear(scope);
    expect(rates.find((r) => r.year === CURRENT_YEAR)?.amountCents).toBe(600);

    const audit = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'rate.changed'));
    expect(audit).toHaveLength(1);
  });

  it('refuses a collector changing the price', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const scope = scopeAs('collector', mosque.mosqueId, mosque.userId);

    await expect(ratesRepo.setRate(scope, CURRENT_YEAR, 600)).rejects.toThrow(/only the imam/i);
  });

  it('changing this year’s rate does not move last year’s debt', async () => {
    const start = CURRENT_YEAR - 2;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = scopeAs('imam', mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });

    await ratesRepo.setRate(scope, CURRENT_YEAR, 600);

    expect((await yearRow(household, start)).obligationCents).toBe(500);
    expect((await yearRow(household, CURRENT_YEAR)).obligationCents).toBe(600);
  });
});
