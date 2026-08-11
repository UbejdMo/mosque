/**
 * Money is integer euro cents, everywhere, always (SPEC §3).
 * No floats, no `numeric`, no arithmetic on formatted strings.
 */

export const CURRENCY = 'EUR' as const;

/** Number/currency formatting is de-DE style: `1.234,50 €` (SPEC §11). */
const NUMBER_LOCALE = 'de-DE';

export type Cents = number;

export function isValidCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** `1234` -> `"12,34 €"` */
export function formatCents(cents: Cents): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    style: 'currency',
    currency: CURRENCY,
  }).format(cents / 100);
}

/** `1234` -> `"12,34"` — for inputs and table cells that carry their own € header. */
export function formatCentsPlain(cents: Cents): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Parse user input in either separator convention (`12,50` and `12.50` both
 * mean twelve fifty) into cents. Returns null on anything it cannot read —
 * callers must handle that rather than defaulting to zero.
 */
export function parseCents(input: string): Cents | null {
  const cleaned = input.trim().replace(/[\s€]/g, '').replace(',', '.');
  if (cleaned === '' || !/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Collector's commission on a batch (SPEC §6).
 * `floor(gross × pct / 100)` — the rounding remainder goes to the mosque, never
 * to the collector. Documented on the batch screen so nobody has to guess.
 *
 * Golden case §5.8/11: gross 1337 @ 10% -> commission 133, net 1204.
 */
export function calcCommission(
  grossCents: Cents,
  commissionPercent: number,
): { commissionCents: Cents; netToMosqueCents: Cents } {
  const commissionCents = Math.floor((grossCents * commissionPercent) / 100);
  return { commissionCents, netToMosqueCents: grossCents - commissionCents };
}
