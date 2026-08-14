import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../test/db.js';
import { CURRENT_YEAR, addHousehold, addPerson, seedMosque } from '../test/factories.js';
import { auditLogs } from '../db/schema/index.js';
import { scopeFor, type Actor, type TenantScope } from '../db/tenancy.js';
import { balanceOf, yearRow } from '../test/ledger-queries.js';
import * as personsRepo from '../repositories/persons.js';
import {
  recordBirth,
  recordEmigration,
  recordExit,
  recordMarriedIn,
  setHeadOfHousehold,
} from './life-events.js';
import { dissolveHousehold, splitHousehold } from './household-split.js';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});
afterAll(async () => {
  await closeTestDb();
});

function staffScope(mosqueId: string, userId: string): TenantScope {
  const actor: Actor = { userId, role: 'collector', mosqueId, householdId: null };
  return scopeFor(actor);
}

const NAME = { firstName: 'Arta', fatherName: 'Ramadan', lastName: 'Krasniqi' };

describe('life events (SPEC §5.2)', () => {
  it('birth makes the child liable from the birth year, inclusive', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 4 });
    const scope = staffScope(mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: CURRENT_YEAR - 4, isHead: true });

    await recordBirth(scope, {
      ...NAME,
      householdId: household,
      birthYear: CURRENT_YEAR - 1,
    });

    expect((await yearRow(household, CURRENT_YEAR - 2)).liablePersonCount).toBe(1);
    expect((await yearRow(household, CURRENT_YEAR - 1)).liablePersonCount).toBe(2);
  });

  it('death ends liability after the year of death, which is still owed in full', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 4 });
    const scope = staffScope(mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    const personId = await addPerson(mosque, household, {
      joinedYear: CURRENT_YEAR - 4,
      isHead: true,
    });

    const deathYear = CURRENT_YEAR - 2;
    const after = await recordExit(scope, personId, { event: 'death', year: deathYear });

    expect(after.exitReason).toBe('deceased');
    // The head marker is released — a departed person cannot head a household.
    expect(after.isHead).toBe(false);
    expect((await yearRow(household, deathYear)).obligationCents).toBe(500);
    expect((await yearRow(household, deathYear + 1)).obligationCents).toBe(0);
  });

  it('emigration changes nothing about what is owed', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 3 });
    const scope = staffScope(mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    const personId = await addPerson(mosque, household, { joinedYear: CURRENT_YEAR - 3 });

    const before = await balanceOf(household);
    const after = await recordEmigration(scope, personId);

    expect(after.livesAbroad).toBe(true);
    expect(after.leftYear).toBeNull();
    expect(after.exitReason).toBeNull();
    expect((await balanceOf(household)).balanceCents).toBe(before.balanceCents);
  });

  it('refuses a second exit event, so a correction has to be deliberate', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 4 });
    const scope = staffScope(mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    const personId = await addPerson(mosque, household, { joinedYear: CURRENT_YEAR - 4 });

    await recordExit(scope, personId, { event: 'married_out', year: CURRENT_YEAR - 2 });
    await expect(
      recordExit(scope, personId, { event: 'death', year: CURRENT_YEAR - 1 }),
    ).rejects.toThrow(/already left/i);
  });

  it('refuses leaving before joining, and leaving in the future', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 4 });
    const scope = staffScope(mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    const personId = await addPerson(mosque, household, { joinedYear: CURRENT_YEAR - 2 });

    await expect(
      recordExit(scope, personId, { event: 'death', year: CURRENT_YEAR - 3 }),
    ).rejects.toThrow(/before joining/i);
    await expect(
      recordExit(scope, personId, { event: 'death', year: CURRENT_YEAR + 1 }),
    ).rejects.toThrow(/future/i);
  });

  it('marrying in adds one to the household from that year', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 4 });
    const scope = staffScope(mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: CURRENT_YEAR - 4, isHead: true });

    const year = CURRENT_YEAR - 1;
    await recordMarriedIn(scope, { ...NAME, householdId: household, year });

    expect((await yearRow(household, year - 1)).liablePersonCount).toBe(1);
    expect((await yearRow(household, year)).liablePersonCount).toBe(2);
  });

  it('moving the head marker leaves exactly one head', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 2 });
    const scope = staffScope(mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    const father = await addPerson(mosque, household, {
      joinedYear: CURRENT_YEAR - 2,
      isHead: true,
    });
    const son = await addPerson(mosque, household, { joinedYear: CURRENT_YEAR - 2 });

    await setHeadOfHousehold(scope, son);

    const people = await personsRepo.listByHousehold(scope, household);
    expect(people.filter((p) => p.isHead).map((p) => p.id)).toEqual([son]);
    expect(people.find((p) => p.id === father)?.isHead).toBe(false);
  });
});

describe('household split (SPEC §5.6)', () => {
  it('leaves past obligations with the original household and starts the new one at the split year', async () => {
    const start = CURRENT_YEAR - 5;
    const splitYear = CURRENT_YEAR - 1;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = staffScope(mosque.mosqueId, mosque.userId);

    const original = await addHousehold(mosque);
    await addPerson(mosque, original, { joinedYear: start, isHead: true });
    const son = await addPerson(mosque, original, { firstName: 'Fatmir', joinedYear: start });

    const before = await balanceOf(original);

    const result = await splitHousehold(scope, {
      sourceHouseholdId: original,
      personIds: [son],
      newHeadPersonId: son,
      splitYear,
    });

    // The year before the split: both still counted in the original household.
    expect((await yearRow(original, splitYear - 1)).liablePersonCount).toBe(2);
    // From the split year the son is counted in the new household only.
    expect((await yearRow(original, splitYear)).liablePersonCount).toBe(1);
    expect((await yearRow(result.newHouseholdId, splitYear)).liablePersonCount).toBe(1);
    // ...and the new household owes nothing for the years before it existed.
    expect((await yearRow(result.newHouseholdId, splitYear - 1)).obligationCents).toBe(0);

    // Nobody is counted twice: the totals still add up to the original debt
    // plus what the two households owe from the split year on.
    const originalAfter = await balanceOf(original);
    const newAfter = await balanceOf(result.newHouseholdId);
    expect(originalAfter.balanceCents + newAfter.balanceCents).toBe(before.balanceCents);
  });

  it('keeps the moved person followable across the split', async () => {
    const start = CURRENT_YEAR - 3;
    const splitYear = CURRENT_YEAR - 1;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = staffScope(mosque.mosqueId, mosque.userId);
    const original = await addHousehold(mosque);
    await addPerson(mosque, original, { joinedYear: start, isHead: true });
    const son = await addPerson(mosque, original, { joinedYear: start });

    const result = await splitHousehold(scope, {
      sourceHouseholdId: original,
      personIds: [son],
      newHeadPersonId: son,
      splitYear,
    });

    const movedId = result.movedPersonIds[0]!;
    const moved = await personsRepo.getById(scope, movedId);
    expect(moved.predecessorPersonId).toBe(son);
    expect(moved.isHead).toBe(true);
    expect(moved.joinedYear).toBe(splitYear);

    const closed = await personsRepo.getById(scope, son);
    expect(closed.leftYear).toBe(splitYear - 1);
  });

  it('moves the row itself when there is no history to preserve', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = staffScope(mosque.mosqueId, mosque.userId);
    const original = await addHousehold(mosque);
    await addPerson(mosque, original, { joinedYear: start, isHead: true });
    // Joined in the split year, so was never liable under the old household.
    const bride = await addPerson(mosque, original, { joinedYear: CURRENT_YEAR });

    const result = await splitHousehold(scope, {
      sourceHouseholdId: original,
      personIds: [bride],
      newHeadPersonId: bride,
      splitYear: CURRENT_YEAR,
    });

    expect(result.movedPersonIds).toEqual([bride]);
    const moved = await personsRepo.getById(scope, bride);
    expect(moved.householdId).toBe(result.newHouseholdId);
    expect(moved.leftYear).toBeNull();
  });

  it('is recorded as one audit event, not a burst of person edits', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = staffScope(mosque.mosqueId, mosque.userId);
    const original = await addHousehold(mosque);
    await addPerson(mosque, original, { joinedYear: start, isHead: true });
    const son = await addPerson(mosque, original, { joinedYear: start });

    await splitHousehold(scope, {
      sourceHouseholdId: original,
      personIds: [son],
      newHeadPersonId: son,
      splitYear: CURRENT_YEAR - 1,
    });

    const rows = await testDb.select().from(auditLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('household.split');
  });

  it('rejects people from another household, and a head who is not moving', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = staffScope(mosque.mosqueId, mosque.userId);
    const original = await addHousehold(mosque);
    const other = await addHousehold(mosque);
    const son = await addPerson(mosque, original, { joinedYear: start });
    const stranger = await addPerson(mosque, other, { joinedYear: start });

    await expect(
      splitHousehold(scope, {
        sourceHouseholdId: original,
        personIds: [stranger],
        newHeadPersonId: stranger,
        splitYear: CURRENT_YEAR,
      }),
    ).rejects.toThrow(/must belong to the household/i);

    await expect(
      splitHousehold(scope, {
        sourceHouseholdId: original,
        personIds: [son],
        newHeadPersonId: stranger,
        splitYear: CURRENT_YEAR,
      }),
    ).rejects.toThrow(/must be one of the people moving/i);

    // A rejected split leaves nothing behind.
    expect(await testDb.select().from(auditLogs)).toHaveLength(0);
  });

  it('a dissolved household keeps its outstanding balance', async () => {
    const start = CURRENT_YEAR - 3;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = staffScope(mosque.mosqueId, mosque.userId);
    const household = await addHousehold(mosque);
    await addPerson(mosque, household, { joinedYear: start });

    const before = await balanceOf(household);
    expect(before.balanceCents).toBeGreaterThan(0);

    await dissolveHousehold(scope, household, 'Familja u shpërnda');

    // Retained and reportable, not written off (SPEC §5.6).
    expect((await balanceOf(household)).balanceCents).toBe(before.balanceCents);
    const rows = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'household.dissolved'));
    expect(rows).toHaveLength(1);
  });
});
