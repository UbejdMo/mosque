import { testDb } from './db.js';
import {
  households,
  mosques,
  paymentAllocations,
  payments,
  persons,
  rates,
  users,
  yearSettlements,
} from '../db/schema/index.js';
import type { EntryReason, ExitReason, SettlementSource } from '@mosque/shared';

/**
 * The view generates years up to the current calendar year, so scenarios are
 * built relative to *now* rather than pinned to literals. A test that passes
 * today and fails on 1 January is worse than no test.
 */
export const CURRENT_YEAR = new Date().getFullYear();

let phoneCounter = 0;

export interface Scenario {
  mosqueId: string;
  userId: string;
}

/** A mosque with a €5 rate for every ledger year, unless told otherwise. */
export async function seedMosque(options: {
  ledgerStartYear: number;
  rateCents?: number;
  /** Explicit per-year rates, for the rate-change case. */
  ratesByYear?: Record<number, number>;
  commissionPercent?: number;
}): Promise<Scenario> {
  const [mosque] = await testDb
    .insert(mosques)
    .values({
      name: 'Xhamia e Fshatit',
      village: 'Fshati',
      ledgerStartYear: options.ledgerStartYear,
      ...(options.commissionPercent === undefined
        ? {}
        : { commissionPercent: options.commissionPercent }),
    })
    .returning({ id: mosques.id });
  if (!mosque) throw new Error('Failed to seed mosque');

  const [user] = await testDb
    .insert(users)
    .values({
      mosqueId: mosque.id,
      phone: `+3834400${String(phoneCounter++).padStart(4, '0')}`,
      pinHash: 'test-not-a-real-hash',
      role: 'collector',
      status: 'active',
    })
    .returning({ id: users.id });
  if (!user) throw new Error('Failed to seed user');

  const rateRows =
    options.ratesByYear !== undefined
      ? Object.entries(options.ratesByYear).map(([year, amountCents]) => ({
          mosqueId: mosque.id,
          year: Number(year),
          amountCents,
        }))
      : yearsFrom(options.ledgerStartYear).map((year) => ({
          mosqueId: mosque.id,
          year,
          amountCents: options.rateCents ?? 500,
        }));

  if (rateRows.length > 0) await testDb.insert(rates).values(rateRows);

  return { mosqueId: mosque.id, userId: user.id };
}

/** Every ledger year from `start` through the current year, inclusive. */
export function yearsFrom(start: number): number[] {
  const years: number[] = [];
  for (let year = start; year <= CURRENT_YEAR; year++) years.push(year);
  return years;
}

export async function addHousehold(scenario: Scenario): Promise<string> {
  const [household] = await testDb
    .insert(households)
    .values({ mosqueId: scenario.mosqueId, neighbourhood: 'Lagja e Poshtme' })
    .returning({ id: households.id });
  if (!household) throw new Error('Failed to seed household');
  return household.id;
}

export async function addPerson(
  scenario: Scenario,
  householdId: string,
  person: {
    firstName?: string;
    joinedYear: number;
    leftYear?: number;
    exitReason?: ExitReason;
    entryReason?: EntryReason;
    livesAbroad?: boolean;
    isHead?: boolean;
  },
): Promise<string> {
  const [row] = await testDb
    .insert(persons)
    .values({
      mosqueId: scenario.mosqueId,
      householdId,
      firstName: person.firstName ?? 'Ismet',
      fatherName: 'Ramadan',
      lastName: 'Krasniqi',
      joinedYear: person.joinedYear,
      leftYear: person.leftYear ?? null,
      exitReason: person.exitReason ?? null,
      entryReason: person.entryReason ?? null,
      livesAbroad: person.livesAbroad ?? false,
      isHead: person.isHead ?? false,
    })
    .returning({ id: persons.id });
  if (!row) throw new Error('Failed to seed person');
  return row.id;
}

export async function addSettlement(
  scenario: Scenario,
  householdId: string,
  year: number,
  source: SettlementSource = 'legacy_import',
): Promise<void> {
  await testDb.insert(yearSettlements).values({
    mosqueId: scenario.mosqueId,
    householdId,
    year,
    source,
    createdBy: scenario.userId,
  });
}

/** Records a payment and its year split, the way the real service will. */
export async function addPayment(
  scenario: Scenario,
  householdId: string,
  payment: {
    totalCents: number;
    allocations: { year: number; amountCents: number }[];
    receiptNumber?: string;
    clientUuid?: string;
    paidAt?: string;
  },
): Promise<string> {
  const [row] = await testDb
    .insert(payments)
    .values({
      mosqueId: scenario.mosqueId,
      householdId,
      clientUuid: payment.clientUuid ?? crypto.randomUUID(),
      paidAt: payment.paidAt ?? `${CURRENT_YEAR}-01-15`,
      totalCents: payment.totalCents,
      receiptNumber: payment.receiptNumber ?? 'R-001',
      collectedBy: scenario.userId,
    })
    .returning({ id: payments.id });
  if (!row) throw new Error('Failed to seed payment');

  if (payment.allocations.length > 0) {
    await testDb.insert(paymentAllocations).values(
      payment.allocations.map((allocation) => ({
        mosqueId: scenario.mosqueId,
        paymentId: row.id,
        year: allocation.year,
        amountCents: allocation.amountCents,
      })),
    );
  }
  return row.id;
}
