import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { rates, type rates as RatesTable } from '../db/schema/index.js';
import { assertCanSetRates, tenantWhere, type TenantScope } from '../db/tenancy.js';
import { writeAudit } from '../lib/audit.js';
import { badRequest } from '../http/errors.js';

export type Rate = typeof RatesTable.$inferSelect;

/**
 * Rates are per-year and set by BIK (SPEC §4.1). Never a single global setting:
 * historical debts must not change when this year's rate changes, which is why
 * the obligation view joins the rate of each individual year.
 */

export async function listByYear(scope: TenantScope): Promise<Rate[]> {
  return db
    .select()
    .from(rates)
    .where(tenantWhere(rates, scope))
    .orderBy(asc(rates.year));
}

/**
 * Set the rate for a year. Imam only — the collector must not move the price
 * (SPEC §4.2).
 *
 * Editing a *past* year silently rewrites what every household owed that year,
 * so the change is audited with its before and after.
 */
export async function setRate(
  scope: TenantScope,
  year: number,
  amountCents: number,
): Promise<Rate> {
  assertCanSetRates(scope);

  if (!Number.isInteger(year)) throw badRequest('Year must be a whole number');
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw badRequest('Rate must be a positive whole number of cents');
  }

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(rates)
      .where(tenantWhere(rates, scope, eq(rates.year, year)))
      .limit(1);

    const [after] = await tx
      .insert(rates)
      .values({ mosqueId: scope.mosqueId, year, amountCents })
      .onConflictDoUpdate({
        target: [rates.mosqueId, rates.year],
        set: { amountCents },
      })
      .returning();
    if (!after) throw new Error('Upsert returned no rate');

    await writeAudit(tx, scope, {
      action: before ? 'rate.changed' : 'rate.set',
      entityType: 'rate',
      entityId: after.id,
      before: before ?? null,
      after,
    });
    return after;
  });
}
