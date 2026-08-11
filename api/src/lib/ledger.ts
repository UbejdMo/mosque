import type { Cents } from '@mosque/shared';

/**
 * FIFO allocation (SPEC §5.5).
 *
 * This file is the one place application code is allowed near the ledger, and
 * only because allocation is procedural. It must never recompute an
 * obligation — those come from `v_household_year_obligation`, always.
 */

export interface OutstandingYear {
  year: number;
  /** What is still owed for this year, from the view. */
  balanceCents: Cents;
}

export interface Allocation {
  year: number;
  amountCents: Cents;
}

export interface AllocationResult {
  allocations: Allocation[];
  /**
   * Money left over after every outstanding year is covered — an overpayment.
   * Returned rather than silently parked on the newest year: the collector
   * should see it and decide, since there is no discount or credit concept in
   * this ledger.
   */
  unallocatedCents: Cents;
}

/**
 * Fill the oldest unpaid year first, spilling into the next once a year is
 * fully covered. A year may end up partially allocated; that is valid.
 *
 * The result is a *proposal*. It is shown in the UI and is overridable before
 * saving — the collector sometimes knows "this €50 is for 2025 specifically".
 */
export function allocateFifo(amountCents: Cents, outstanding: OutstandingYear[]): AllocationResult {
  assertPositiveInt(amountCents, 'amountCents');

  const years = [...outstanding]
    .filter((y) => y.balanceCents > 0)
    .sort((a, b) => a.year - b.year);

  const allocations: Allocation[] = [];
  let remaining = amountCents;

  for (const year of years) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, year.balanceCents);
    allocations.push({ year: year.year, amountCents: amount });
    remaining -= amount;
  }

  return { allocations, unallocatedCents: remaining };
}

/**
 * Validate an allocation the collector edited by hand before it reaches the
 * database. The split must account for the payment exactly — a payment whose
 * parts do not sum to its total would put the ledger permanently out of step
 * with the paper receipt.
 */
export function assertAllocationsValid(totalCents: Cents, allocations: Allocation[]): void {
  assertPositiveInt(totalCents, 'totalCents');

  if (allocations.length === 0) {
    throw new Error('A payment must be allocated to at least one year');
  }

  const seen = new Set<number>();
  for (const allocation of allocations) {
    assertPositiveInt(allocation.amountCents, `allocation for ${allocation.year}`);
    if (!Number.isInteger(allocation.year)) {
      throw new Error(`Allocation year must be an integer, got ${allocation.year}`);
    }
    if (seen.has(allocation.year)) {
      throw new Error(`Year ${allocation.year} appears twice in one allocation`);
    }
    seen.add(allocation.year);
  }

  const sum = allocations.reduce((total, a) => total + a.amountCents, 0);
  if (sum !== totalCents) {
    throw new Error(`Allocations sum to ${sum} cents but the payment is ${totalCents} cents`);
  }
}

function assertPositiveInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive whole number of cents, got ${value}`);
  }
}
