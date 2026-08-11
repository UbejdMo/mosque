import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { calcCommission } from '@mosque/shared';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../test/db.js';
import {
  CURRENT_YEAR,
  addHousehold,
  addPayment,
  addPerson,
  addSettlement,
  seedMosque,
  yearsFrom,
} from '../test/factories.js';
import { balanceOf, yearRow, yearRows } from '../test/ledger-queries.js';
import { allocateFifo, assertAllocationsValid } from './ledger.js';

/**
 * The golden cases from SPEC §5.8.
 *
 * The view enforces *one* definition of "owed"; these prove it is the *right*
 * one. If any of them ever go red, stop and fix before shipping. These are the
 * app.
 *
 * Liability is inclusive at both ends — confirmed with the collector: someone
 * who dies in March owes the full year, a baby born in November owes the full
 * year. No pro-rata.
 */
describe('golden cases (SPEC §5.8)', () => {
  beforeAll(async () => {
    await migrateTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it('1. simple household: 4 persons, 3 unpaid years, flat €5 rate → €60', async () => {
    const scenario = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 2 });
    const household = await addHousehold(scenario);
    for (let i = 0; i < 4; i++) {
      await addPerson(scenario, household, { joinedYear: CURRENT_YEAR - 2 });
    }

    const balance = await balanceOf(household);
    expect(balance.balanceCents).toBe(6000);
    expect(balance.yearsUnpaid).toBe(3);
  });

  it('2. rate change mid-history: unpaid years before the change still price at the old rate', async () => {
    // The spec illustrates this with a 2028 change; the view only generates
    // years up to today, so the change is placed in the past instead. The
    // invariant under test is identical.
    const changeYear = CURRENT_YEAR - 2;
    const ratesByYear: Record<number, number> = {};
    for (const year of yearsFrom(CURRENT_YEAR - 4)) {
      ratesByYear[year] = year < changeYear ? 500 : 600;
    }
    const scenario = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 4, ratesByYear });
    const household = await addHousehold(scenario);
    await addPerson(scenario, household, { joinedYear: CURRENT_YEAR - 4 });

    expect((await yearRow(household, CURRENT_YEAR - 4)).obligationCents).toBe(500);
    expect((await yearRow(household, CURRENT_YEAR - 3)).obligationCents).toBe(500);
    expect((await yearRow(household, changeYear)).obligationCents).toBe(600);
    expect((await yearRow(household, CURRENT_YEAR)).obligationCents).toBe(600);
  });

  it('3. death in 2022 with arrears back to 2016 → liable 2016–2022, nothing after', async () => {
    const start = CURRENT_YEAR - 10;
    const deathYear = CURRENT_YEAR - 4;
    const scenario = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(scenario);
    await addPerson(scenario, household, {
      joinedYear: start,
      leftYear: deathYear,
      exitReason: 'deceased',
    });

    // Liable through the year of death, inclusive.
    expect((await yearRow(household, deathYear)).liablePersonCount).toBe(1);
    expect((await yearRow(household, deathYear)).obligationCents).toBe(500);
    expect((await yearRow(household, deathYear + 1)).liablePersonCount).toBe(0);
    expect((await yearRow(household, deathYear + 1)).obligationCents).toBe(0);

    const yearsLiable = deathYear - start + 1;
    expect((await balanceOf(household)).balanceCents).toBe(yearsLiable * 500);
  });

  it('4. baby born 2024 in a household unpaid since 2016 → liable 2024 onward only', async () => {
    const start = CURRENT_YEAR - 10;
    const birthYear = CURRENT_YEAR - 2;
    const scenario = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(scenario);
    await addPerson(scenario, household, { joinedYear: start, isHead: true });
    await addPerson(scenario, household, { joinedYear: birthYear, entryReason: 'birth' });

    expect((await yearRow(household, birthYear - 1)).liablePersonCount).toBe(1);
    // Liable for the year of birth, inclusive.
    expect((await yearRow(household, birthYear)).liablePersonCount).toBe(2);
    expect((await yearRow(household, birthYear)).obligationCents).toBe(1000);
  });

  it('5. daughter marries out in 2021 → liable through 2021 inclusive', async () => {
    const start = CURRENT_YEAR - 8;
    const marriageYear = CURRENT_YEAR - 5;
    const scenario = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(scenario);
    await addPerson(scenario, household, { joinedYear: start, isHead: true });
    await addPerson(scenario, household, {
      firstName: 'Drita',
      joinedYear: start,
      leftYear: marriageYear,
      exitReason: 'married_out',
    });

    expect((await yearRow(household, marriageYear)).liablePersonCount).toBe(2);
    expect((await yearRow(household, marriageYear + 1)).liablePersonCount).toBe(1);
  });

  it('6. bride marries in during 2023 → liable from 2023 inclusive; household count +1', async () => {
    const start = CURRENT_YEAR - 6;
    const marriageYear = CURRENT_YEAR - 3;
    const scenario = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(scenario);
    await addPerson(scenario, household, { joinedYear: start, isHead: true });
    await addPerson(scenario, household, {
      firstName: 'Arta',
      joinedYear: marriageYear,
      entryReason: 'married_in',
    });

    expect((await yearRow(household, marriageYear - 1)).liablePersonCount).toBe(1);
    expect((await yearRow(household, marriageYear)).liablePersonCount).toBe(2);
    expect((await yearRow(household, marriageYear)).obligationCents).toBe(1000);
  });

  it('7. emigrant with livesAbroad → fully liable, no exemption', async () => {
    const start = CURRENT_YEAR - 3;
    const scenario = await seedMosque({ ledgerStartYear: start });

    const stayed = await addHousehold(scenario);
    await addPerson(scenario, stayed, { joinedYear: start });

    const emigrated = await addHousehold(scenario);
    await addPerson(scenario, emigrated, { joinedYear: start, livesAbroad: true });

    // Living abroad changes nothing at all about what is owed.
    expect((await balanceOf(emigrated)).balanceCents).toBe(
      (await balanceOf(stayed)).balanceCents,
    );
    expect((await balanceOf(emigrated)).balanceCents).toBe(4 * 500);
  });

  it('8. legacy settlement on a year → that year contributes €0 regardless of person data', async () => {
    const start = CURRENT_YEAR - 5;
    const settledYear = CURRENT_YEAR - 3;
    const scenario = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(scenario);
    // Six people in the household — the settled year must ignore all of them.
    for (let i = 0; i < 6; i++) await addPerson(scenario, household, { joinedYear: start });
    await addSettlement(scenario, household, settledYear);

    const settled = await yearRow(household, settledYear);
    expect(settled.obligationCents).toBe(0);
    expect(settled.balanceCents).toBe(0);
    expect(settled.status).toBe('settled');
    expect(settled.isSettled).toBe(true);

    // Neighbouring years are untouched: 6 persons × €5.
    expect((await yearRow(household, settledYear + 1)).obligationCents).toBe(3000);
  });

  it('9. partial payment: FIFO fills the oldest years first, balance drops by what was paid', async () => {
    // 10 persons × €5 × 10 years = €500 of arrears.
    const start = CURRENT_YEAR - 9;
    const scenario = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(scenario);
    for (let i = 0; i < 10; i++) await addPerson(scenario, household, { joinedYear: start });

    expect((await balanceOf(household)).balanceCents).toBe(50_000);

    const outstanding = (await yearRows(household)).map((r) => ({
      year: r.year,
      balanceCents: r.balanceCents,
    }));
    const { allocations, unallocatedCents } = allocateFifo(10_000, outstanding);

    // €100 against €50/year covers exactly the two oldest years.
    expect(unallocatedCents).toBe(0);
    expect(allocations).toEqual([
      { year: start, amountCents: 5000 },
      { year: start + 1, amountCents: 5000 },
    ]);

    await addPayment(scenario, household, { totalCents: 10_000, allocations });

    expect((await balanceOf(household)).balanceCents).toBe(40_000);
    expect((await yearRow(household, start)).status).toBe('paid');
    expect((await yearRow(household, start + 2)).status).toBe('unpaid');
  });

  it('9b. a payment that does not divide evenly leaves exactly one year partially allocated', async () => {
    const start = CURRENT_YEAR - 9;
    const scenario = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(scenario);
    for (let i = 0; i < 10; i++) await addPerson(scenario, household, { joinedYear: start });

    const outstanding = (await yearRows(household)).map((r) => ({
      year: r.year,
      balanceCents: r.balanceCents,
    }));
    const { allocations } = allocateFifo(12_000, outstanding);
    await addPayment(scenario, household, { totalCents: 12_000, allocations });

    const rows = await yearRows(household);
    expect(rows.filter((r) => r.status === 'partial')).toHaveLength(1);
    expect((await yearRow(household, start + 2)).status).toBe('partial');
    expect((await yearRow(household, start + 2)).allocatedCents).toBe(2000);
    expect((await balanceOf(household)).balanceCents).toBe(38_000);
  });

  it('10. manual override: the payment lands on the specified year, not the FIFO one', async () => {
    const start = CURRENT_YEAR - 4;
    const scenario = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(scenario);
    await addPerson(scenario, household, { joinedYear: start });

    // "This €5 is for this year specifically" — the collector overrides FIFO,
    // which would have chosen the oldest unpaid year.
    const override = [{ year: CURRENT_YEAR, amountCents: 500 }];
    assertAllocationsValid(500, override);
    await addPayment(scenario, household, { totalCents: 500, allocations: override });

    expect((await yearRow(household, CURRENT_YEAR)).status).toBe('paid');
    expect((await yearRow(household, start)).status).toBe('unpaid');
    expect((await balanceOf(household)).oldestUnpaidYear).toBe(start);
  });

  it('11. commission rounding: gross 1337 at 10% → commission 133, net 1204', () => {
    expect(calcCommission(1337, 10)).toEqual({ commissionCents: 133, netToMosqueCents: 1204 });
    // The remainder goes to the mosque, never to the collector.
    expect(calcCommission(1337, 10).commissionCents + calcCommission(1337, 10).netToMosqueCents)
      .toBe(1337);
  });

  it('12. same clientUuid submitted twice → one payment, balance unchanged on the replay', async () => {
    const start = CURRENT_YEAR - 2;
    const scenario = await seedMosque({ ledgerStartYear: start });
    const household = await addHousehold(scenario);
    await addPerson(scenario, household, { joinedYear: start });

    const clientUuid = crypto.randomUUID();
    await addPayment(scenario, household, {
      totalCents: 500,
      allocations: [{ year: start, amountCents: 500 }],
      clientUuid,
    });
    const afterFirst = (await balanceOf(household)).balanceCents;

    // The outbox replays the same payment — this is the sync path, so it must
    // be a no-op rather than an error the collector has to interpret.
    const replay = await testDb.execute(sql`
      INSERT INTO payments (mosque_id, household_id, client_uuid, paid_at, total_cents,
                            receipt_number, collected_by)
      VALUES (${scenario.mosqueId}, ${household}, ${clientUuid}, ${`${CURRENT_YEAR}-01-15`},
              500, 'R-001', ${scenario.userId})
      ON CONFLICT (client_uuid) DO NOTHING
      RETURNING id
    `);
    expect(replay.rowCount).toBe(0);

    const count = await testDb.execute(sql`SELECT count(*)::int AS n FROM payments`);
    expect(count.rows[0]).toEqual({ n: 1 });
    expect((await balanceOf(household)).balanceCents).toBe(afterFirst);
  });
});
