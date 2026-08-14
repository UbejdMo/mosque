import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeTestDb, resetTestDb, testDb } from '../test/db.js';
import { CURRENT_YEAR, seedMosque } from '../test/factories.js';
import { auditLogs, households } from '../db/schema/index.js';
import { scopeFor, type Actor, type TenantScope } from '../db/tenancy.js';
import { balanceOf, yearRow } from '../test/ledger-queries.js';
import { importHouseholds, type ImportHouseholdInput } from './legacy-import.js';

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

function household(overrides: Partial<ImportHouseholdInput> = {}): ImportHouseholdInput {
  return {
    neighbourhood: 'Lagja e Poshtme',
    persons: [
      {
        firstName: 'Ismet',
        fatherName: 'Ramadan',
        lastName: 'Krasniqi',
        joinedYear: CURRENT_YEAR - 5,
        isHead: true,
      },
    ],
    settledYears: [],
    ...overrides,
  };
}

describe('legacy notebook import (SPEC §15, §5.4)', () => {
  it('ticked years contribute nothing, unticked years are computed', async () => {
    const start = CURRENT_YEAR - 5;
    const mosque = await seedMosque({ ledgerStartYear: start });
    const scope = staffScope(mosque.mosqueId, mosque.userId);

    const result = await importHouseholds(scope, [
      household({
        persons: [
          {
            firstName: 'Ismet',
            fatherName: 'Ramadan',
            lastName: 'Krasniqi',
            joinedYear: start,
            isHead: true,
          },
          {
            firstName: 'Arta',
            fatherName: 'Ismet',
            lastName: 'Krasniqi',
            joinedYear: start,
          },
        ],
        // The notebook shows ticks against the first three years.
        settledYears: [start, start + 1, start + 2],
      }),
    ]);

    const id = result.householdIds[0]!;
    expect(result.personCount).toBe(2);
    expect(result.settlementCount).toBe(3);

    // A settled year is closed regardless of how many people are in it.
    expect((await yearRow(id, start)).obligationCents).toBe(0);
    expect((await yearRow(id, start)).status).toBe('settled');
    // Unticked years still price from person data: 2 people × €5.
    expect((await yearRow(id, start + 3)).obligationCents).toBe(1000);

    // Three unpaid years remain (start+3 … CURRENT_YEAR).
    expect((await balanceOf(id)).balanceCents).toBe(3 * 1000);
  });

  it('records one audit row per imported household', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 3 });
    const scope = staffScope(mosque.mosqueId, mosque.userId);

    await importHouseholds(scope, [household(), household(), household()]);

    const rows = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'household.imported'));
    expect(rows).toHaveLength(3);
  });

  it('carries the needs-review flag rather than forcing a decision', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 3 });
    const scope = staffScope(mosque.mosqueId, mosque.userId);

    // SPEC §15: the notebook contradicts itself; flag it and move on.
    const result = await importHouseholds(scope, [
      household({ needsReview: true, notes: 'Viti 2019 i palexueshëm' }),
    ]);

    const [row] = await testDb
      .select()
      .from(households)
      .where(eq(households.id, result.householdIds[0]!));
    expect(row?.needsReview).toBe(true);
  });

  it('rolls the whole batch back if one row is bad', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 3 });
    const scope = staffScope(mosque.mosqueId, mosque.userId);

    await expect(
      importHouseholds(scope, [
        household(),
        // A settled year from before the ledger even starts.
        household({ settledYears: [1990] }),
        household(),
      ]),
    ).rejects.toThrow(/outside the ledger/i);

    // Nothing partial: a half-imported notebook is worse than none.
    expect(await testDb.select().from(households)).toHaveLength(0);
    expect(await testDb.select().from(auditLogs)).toHaveLength(0);
  });

  it('names the offending row so the transcriber can find it', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 3 });
    const scope = staffScope(mosque.mosqueId, mosque.userId);

    await expect(
      importHouseholds(scope, [household(), household({ settledYears: [1990] })]),
    ).rejects.toThrow(/row 2/i);
  });

  it('insists on exactly one head of household', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 3 });
    const scope = staffScope(mosque.mosqueId, mosque.userId);

    const noHead = household({
      persons: [
        {
          firstName: 'Ismet',
          fatherName: 'Ramadan',
          lastName: 'Krasniqi',
          joinedYear: CURRENT_YEAR - 3,
        },
      ],
    });
    await expect(importHouseholds(scope, [noHead])).rejects.toThrow(/exactly one head/i);

    const twoHeads = household({
      persons: [
        {
          firstName: 'Ismet',
          fatherName: 'Ramadan',
          lastName: 'Krasniqi',
          joinedYear: CURRENT_YEAR - 3,
          isHead: true,
        },
        {
          firstName: 'Fatmir',
          fatherName: 'Ramadan',
          lastName: 'Krasniqi',
          joinedYear: CURRENT_YEAR - 3,
          isHead: true,
        },
      ],
    });
    await expect(importHouseholds(scope, [twoHeads])).rejects.toThrow(/exactly one head/i);
  });

  it('rejects a duplicated tick and a missing father name', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 3 });
    const scope = staffScope(mosque.mosqueId, mosque.userId);

    await expect(
      importHouseholds(scope, [household({ settledYears: [CURRENT_YEAR, CURRENT_YEAR] })]),
    ).rejects.toThrow(/ticked twice/i);

    await expect(
      importHouseholds(scope, [
        household({
          persons: [
            {
              firstName: 'Ismet',
              fatherName: '   ',
              lastName: 'Krasniqi',
              joinedYear: CURRENT_YEAR - 3,
              isHead: true,
            },
          ],
        }),
      ]),
    ).rejects.toThrow(/father/i);
  });

  it('a member cannot import', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 3 });
    const scope = scopeFor({
      userId: mosque.userId,
      role: 'member',
      mosqueId: mosque.mosqueId,
      householdId: '00000000-0000-0000-0000-000000000000',
    });
    await expect(importHouseholds(scope, [household()])).rejects.toThrow(/read-only/i);
  });
});
