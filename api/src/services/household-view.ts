import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type {
  HouseholdDetailDto,
  HouseholdSummaryDto,
  HouseholdYearDto,
  PaymentDto,
  PersonDto,
  SettlementSource,
  YearStatus,
} from '@mosque/shared';
import { db } from '../db/client.js';
import {
  paymentAllocations,
  payments,
  persons,
  vHouseholdYearObligation,
} from '../db/schema/index.js';
import { householdScopedWhere, tenantWhere, type TenantScope } from '../db/tenancy.js';
import * as householdsRepo from '../repositories/households.js';
import * as personsRepo from '../repositories/persons.js';

/**
 * Assembles what the household detail screen needs (SPEC §10): the people, the
 * year-by-year grid, the payment history and the balance.
 *
 * Every number here comes from `v_household_year_obligation`. Nothing is
 * recomputed (SPEC §5.3).
 */

export async function listHouseholds(
  scope: TenantScope,
  options: householdsRepo.ListOptions,
): Promise<HouseholdSummaryDto[]> {
  const rows = await householdsRepo.list(scope, options);
  if (rows.length === 0) return [];

  // One query for every household's people, rather than one per household.
  const householdIds = rows.map((row) => row.id);
  const people = await db
    .select({
      householdId: persons.householdId,
      firstName: persons.firstName,
      fatherName: persons.fatherName,
      lastName: persons.lastName,
      isHead: persons.isHead,
      leftYear: persons.leftYear,
    })
    .from(persons)
    .where(
      and(
        tenantWhere(persons, scope),
        inArray(persons.householdId, householdIds),
        isNull(persons.deletedAt),
      ),
    );

  const byHousehold = new Map<string, typeof people>();
  for (const person of people) {
    const list = byHousehold.get(person.householdId) ?? [];
    list.push(person);
    byHousehold.set(person.householdId, list);
  }

  return rows.map((row) => {
    const members = byHousehold.get(row.id) ?? [];
    // Only people still in the household count towards its size.
    const current = members.filter((person) => person.leftYear === null);
    const head = current.find((person) => person.isHead);
    return {
      id: row.id,
      status: row.status,
      neighbourhood: row.neighbourhood,
      phone: row.phone,
      notes: row.notes,
      needsReview: row.needsReview,
      headName: head ? fullName(head) : null,
      personCount: current.length,
      balanceCents: row.balanceCents,
      yearsUnpaid: row.yearsUnpaid,
      oldestUnpaidYear: row.oldestUnpaidYear,
    };
  });
}

export async function getHouseholdDetail(
  scope: TenantScope,
  householdId: string,
): Promise<HouseholdDetailDto> {
  const household = await householdsRepo.getById(scope, householdId);
  const people = await personsRepo.listByHousehold(scope, householdId);

  const yearRows = await db
    .select()
    .from(vHouseholdYearObligation)
    .where(
      householdScopedWhere(
        vHouseholdYearObligation,
        scope,
        eq(vHouseholdYearObligation.householdId, householdId),
      ),
    )
    .orderBy(asc(vHouseholdYearObligation.year));

  const paymentRows = await db
    .select()
    .from(payments)
    .where(tenantWhere(payments, scope, eq(payments.householdId, householdId)))
    .orderBy(asc(payments.paidAt));

  const allocationRows =
    paymentRows.length === 0
      ? []
      : await db
          .select()
          .from(paymentAllocations)
          .where(
            inArray(
              paymentAllocations.paymentId,
              paymentRows.map((payment) => payment.id),
            ),
          )
          .orderBy(asc(paymentAllocations.year));

  const current = people.filter((person) => person.leftYear === null);
  const head = current.find((person) => person.isHead);

  const balanceCents = yearRows.reduce((total, row) => total + row.balanceCents, 0);
  const unpaidYears = yearRows.filter((row) => row.balanceCents > 0);

  return {
    household: {
      id: household.id,
      status: household.status,
      neighbourhood: household.neighbourhood,
      phone: household.phone,
      notes: household.notes,
      needsReview: household.needsReview,
      headName: head ? fullName(head) : null,
      personCount: current.length,
      balanceCents,
      yearsUnpaid: unpaidYears.length,
      oldestUnpaidYear: unpaidYears[0]?.year ?? null,
    },
    persons: people.map(toPersonDto),
    years: yearRows.map(
      (row): HouseholdYearDto => ({
        year: row.year,
        liablePersonCount: row.liablePersonCount,
        rateCents: row.rateCents,
        rateMissing: row.rateMissing,
        obligationCents: row.obligationCents,
        allocatedCents: row.allocatedCents,
        balanceCents: row.balanceCents,
        status: row.status as YearStatus,
        isSettled: row.isSettled,
        settlementSource: row.settlementSource as SettlementSource | null,
      }),
    ),
    payments: paymentRows.map(
      (payment): PaymentDto => ({
        id: payment.id,
        paidAt: payment.paidAt,
        totalCents: payment.totalCents,
        receiptNumber: payment.receiptNumber,
        note: payment.note,
        batchId: payment.batchId,
        allocations: allocationRows
          .filter((allocation) => allocation.paymentId === payment.id)
          .map((allocation) => ({ year: allocation.year, amountCents: allocation.amountCents })),
      }),
    ),
  };
}

export function toPersonDto(person: personsRepo.Person): PersonDto {
  return {
    id: person.id,
    firstName: person.firstName,
    fatherName: person.fatherName,
    lastName: person.lastName,
    joinedYear: person.joinedYear,
    leftYear: person.leftYear,
    entryReason: person.entryReason,
    exitReason: person.exitReason,
    isHead: person.isHead,
    livesAbroad: person.livesAbroad,
    predecessorPersonId: person.predecessorPersonId,
  };
}

/** Albanian convention: `Emri (Atësia) Mbiemri` (SPEC §4.1). */
function fullName(person: { firstName: string; fatherName: string; lastName: string }): string {
  return `${person.firstName} ${person.fatherName} ${person.lastName}`;
}
