import { formatCents, formatCentsPlain, parseCents, type Cents } from '@mosque/shared';

/**
 * Presentation only. Every figure shown here came from the server, which got it
 * from the obligation views — nothing is added up in the browser (SPEC §5.3).
 */

export { formatCents, formatCentsPlain, parseCents };
export type { Cents };

/** Dates read `dd.MM.yyyy` (SPEC §11). */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}.${month}.${year}`;
}

/** `YYYY-MM-DD` in local time, for date inputs and payment dates. */
export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
