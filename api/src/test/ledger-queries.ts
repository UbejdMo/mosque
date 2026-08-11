import { and, eq } from 'drizzle-orm';
import { testDb } from './db.js';
import { vHouseholdBalance, vHouseholdYearObligation } from '../db/schema/index.js';

/**
 * Read helpers for the tests. They query the views and nothing else — if a
 * number in here were computed in TypeScript, the suite would be testing
 * itself rather than the ledger.
 */

export interface YearRow {
  year: number;
  liablePersonCount: number;
  obligationCents: number;
  allocatedCents: number;
  balanceCents: number;
  status: string;
  isSettled: boolean;
}

export async function yearRows(householdId: string): Promise<YearRow[]> {
  const rows = await testDb
    .select({
      year: vHouseholdYearObligation.year,
      liablePersonCount: vHouseholdYearObligation.liablePersonCount,
      obligationCents: vHouseholdYearObligation.obligationCents,
      allocatedCents: vHouseholdYearObligation.allocatedCents,
      balanceCents: vHouseholdYearObligation.balanceCents,
      status: vHouseholdYearObligation.status,
      isSettled: vHouseholdYearObligation.isSettled,
    })
    .from(vHouseholdYearObligation)
    .where(eq(vHouseholdYearObligation.householdId, householdId));

  return rows.sort((a, b) => a.year - b.year);
}

export async function yearRow(householdId: string, year: number): Promise<YearRow> {
  const rows = await yearRows(householdId);
  const row = rows.find((r) => r.year === year);
  if (!row) throw new Error(`No ledger row for ${year}`);
  return row;
}

export async function balanceOf(householdId: string): Promise<{
  balanceCents: number;
  totalObligationCents: number;
  totalAllocatedCents: number;
  yearsUnpaid: number;
  oldestUnpaidYear: number | null;
}> {
  const [row] = await testDb
    .select({
      balanceCents: vHouseholdBalance.balanceCents,
      totalObligationCents: vHouseholdBalance.totalObligationCents,
      totalAllocatedCents: vHouseholdBalance.totalAllocatedCents,
      yearsUnpaid: vHouseholdBalance.yearsUnpaid,
      oldestUnpaidYear: vHouseholdBalance.oldestUnpaidYear,
    })
    .from(vHouseholdBalance)
    .where(and(eq(vHouseholdBalance.householdId, householdId)));
  if (!row) throw new Error('No balance row for household');
  return row;
}
