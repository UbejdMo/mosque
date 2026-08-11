import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../test/db.js';
import { CURRENT_YEAR, addHousehold, addPerson, seedMosque } from '../test/factories.js';
import { auditLogs } from '../db/schema/index.js';
import { scopeFor, type Actor } from '../db/tenancy.js';
import * as householdsRepo from './households.js';
import { AppError } from '../http/errors.js';

/**
 * SPEC §13: every query scoped by mosque_id, enforced in the repository layer.
 * SPEC hard rule 2: no member may ever see another member's payment status.
 *
 * These are the tests that stop a cross-tenant leak, so they poke at the
 * repository the way a bug would — by asking for the wrong thing directly.
 */
// File-scoped: the pool is shared by every describe block in this file, so it
// is opened and closed once here rather than once per block.
beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});
afterAll(async () => {
  await closeTestDb();
});

describe('tenancy scoping', () => {
  function staffActor(mosqueId: string, userId: string): Actor {
    return { userId, role: 'collector', mosqueId, householdId: null };
  }

  function memberActor(mosqueId: string, userId: string, householdId: string): Actor {
    return { userId, role: 'member', mosqueId, householdId };
  }

  it('lists only the households of the actor’s own mosque', async () => {
    const a = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const b = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const householdA = await addHousehold(a);
    await addHousehold(b);
    await addHousehold(b);

    const scope = scopeFor(staffActor(a.mosqueId, a.userId));
    const visible = await householdsRepo.list(scope);

    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(householdA);
  });

  it('cannot fetch another mosque’s household by id, even knowing the id', async () => {
    const a = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const b = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const householdB = await addHousehold(b);

    const scope = scopeFor(staffActor(a.mosqueId, a.userId));
    expect(await householdsRepo.findById(scope, householdB)).toBeNull();
    await expect(householdsRepo.getById(scope, householdB)).rejects.toThrow(/not found/i);
  });

  it('cannot update another mosque’s household', async () => {
    const a = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const b = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const householdB = await addHousehold(b);

    const scope = scopeFor(staffActor(a.mosqueId, a.userId));
    await expect(
      householdsRepo.update(scope, householdB, { notes: 'tampered' }),
    ).rejects.toThrow(/not found/i);
  });

  it('a member sees only their own household', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const mine = await addHousehold(mosque);
    const neighbour = await addHousehold(mosque);
    await addPerson(mosque, neighbour, { joinedYear: CURRENT_YEAR - 1 });

    const scope = scopeFor(memberActor(mosque.mosqueId, mosque.userId, mine));

    const visible = await householdsRepo.list(scope);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(mine);

    // The neighbour's household is in the same mosque — only the member
    // restriction keeps it out of reach.
    expect(await householdsRepo.findById(scope, neighbour)).toBeNull();
    expect(await householdsRepo.findById(scope, mine)).not.toBeNull();
  });

  it('a member cannot write', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const mine = await addHousehold(mosque);
    const scope = scopeFor(memberActor(mosque.mosqueId, mosque.userId, mine));

    await expect(householdsRepo.create(scope, {})).rejects.toThrow(/read-only/i);
    await expect(householdsRepo.update(scope, mine, { notes: 'x' })).rejects.toThrow(/read-only/i);
  });

  it('a member with no linked household is refused rather than shown everything', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    await addHousehold(mosque);
    const scope = scopeFor({
      userId: mosque.userId,
      role: 'member',
      mosqueId: mosque.mosqueId,
      householdId: null,
    });

    // The dangerous failure mode would be an unfiltered list.
    await expect(householdsRepo.list(scope)).rejects.toThrow(/not linked to a household/i);
  });

  it('staff cannot request another mosque by passing its id', async () => {
    const a = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const b = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });

    expect(() => scopeFor(staffActor(a.mosqueId, a.userId), b.mosqueId)).toThrow(
      /another mosque/i,
    );
  });

  it('a super_admin must name a mosque explicitly', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const superAdmin: Actor = {
      userId: mosque.userId,
      role: 'super_admin',
      mosqueId: null,
      householdId: null,
    };

    expect(() => scopeFor(superAdmin)).toThrow(AppError);
    expect(scopeFor(superAdmin, mosque.mosqueId).mosqueId).toBe(mosque.mosqueId);
  });

  it('soft-deleted households drop out of the ledger but are not destroyed', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const household = await addHousehold(mosque);
    const scope = scopeFor(staffActor(mosque.mosqueId, mosque.userId));

    await householdsRepo.softDelete(scope, household);

    expect(await householdsRepo.list(scope)).toHaveLength(0);
    expect(await householdsRepo.list(scope, { includeDeleted: true })).toHaveLength(1);
  });
});

describe('audit log', () => {
  it('records the actor, the action and the before/after of a change', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const scope = scopeFor({
      userId: mosque.userId,
      role: 'collector',
      mosqueId: mosque.mosqueId,
      householdId: null,
      ip: '10.0.0.7',
    });

    const created = await householdsRepo.create(scope, { neighbourhood: 'Lagja e Epërme' });
    await householdsRepo.update(scope, created.id, { notes: 'kontrolluar' });

    const rows = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, created.id));

    expect(rows.map((r) => r.action).sort()).toEqual(['household.created', 'household.updated']);

    const updateRow = rows.find((r) => r.action === 'household.updated');
    expect(updateRow?.actorUserId).toBe(mosque.userId);
    expect(updateRow?.ip).toBe('10.0.0.7');
    expect((updateRow?.before as { notes: string | null }).notes).toBeNull();
    expect((updateRow?.after as { notes: string | null }).notes).toBe('kontrolluar');
  });

  it('rolls the audit row back with the change it describes', async () => {
    const mosque = await seedMosque({ ledgerStartYear: CURRENT_YEAR - 1 });
    const scope = scopeFor({
      userId: mosque.userId,
      role: 'collector',
      mosqueId: mosque.mosqueId,
      householdId: null,
    });

    // A household id that does not exist: the update must fail, and must not
    // leave behind a log entry claiming something happened.
    await expect(
      householdsRepo.update(scope, '00000000-0000-0000-0000-000000000000', { notes: 'x' }),
    ).rejects.toThrow();

    const rows = await testDb.select().from(auditLogs);
    expect(rows).toHaveLength(0);
  });
});
