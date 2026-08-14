import type {
  EntryReason,
  ExitReason,
  HouseholdStatus,
  SettlementSource,
  YearStatus,
} from './domain.js';

/**
 * The wire contract (SPEC §3). These live in `/shared` so the web SPA and a
 * future Expo client inherit exactly the same shapes — there are no web-only
 * endpoints and no server-rendered views to diverge from.
 *
 * Conventions:
 * - money is integer cents, in `*Cents` fields;
 * - dates are `YYYY-MM-DD` strings, timestamps are ISO 8601 strings;
 * - years are plain integers.
 */

export interface PersonDto {
  id: string;
  firstName: string;
  fatherName: string;
  lastName: string;
  joinedYear: number;
  leftYear: number | null;
  entryReason: EntryReason | null;
  exitReason: ExitReason | null;
  isHead: boolean;
  livesAbroad: boolean;
  /** Set when this row continues a person from a household split (SPEC §5.6). */
  predecessorPersonId: string | null;
}

/** One cell of the year grid (SPEC §10). */
export interface HouseholdYearDto {
  year: number;
  liablePersonCount: number;
  rateCents: number | null;
  /** True when no rate has been set for this year — not the same as owing €0. */
  rateMissing: boolean;
  obligationCents: number;
  allocatedCents: number;
  balanceCents: number;
  status: YearStatus;
  isSettled: boolean;
  settlementSource: SettlementSource | null;
}

export interface HouseholdSummaryDto {
  id: string;
  status: HouseholdStatus;
  neighbourhood: string | null;
  phone: string | null;
  notes: string | null;
  needsReview: boolean;
  headName: string | null;
  personCount: number;
  balanceCents: number;
  yearsUnpaid: number;
  oldestUnpaidYear: number | null;
}

export interface PaymentDto {
  id: string;
  paidAt: string;
  totalCents: number;
  receiptNumber: string;
  note: string | null;
  batchId: string | null;
  allocations: PaymentAllocationDto[];
}

export interface PaymentAllocationDto {
  year: number;
  amountCents: number;
}

export interface HouseholdDetailDto {
  household: HouseholdSummaryDto;
  persons: PersonDto[];
  years: HouseholdYearDto[];
  payments: PaymentDto[];
}

export interface RateDto {
  year: number;
  amountCents: number;
}

/** The FIFO proposal shown before a payment is saved (SPEC §5.5). */
export interface AllocationPreviewDto {
  allocations: PaymentAllocationDto[];
  /** Money that could not be placed — nothing is owed for it. */
  unallocatedCents: number;
  outstanding: { year: number; balanceCents: number }[];
}

export interface RecordPaymentResultDto {
  payment: PaymentDto;
  /** True when a replayed sync matched an existing payment (SPEC §9). */
  replayed: boolean;
  /** Duplicates are flagged, never blocked — the paper book is the record. */
  duplicateReceipt: boolean;
}
