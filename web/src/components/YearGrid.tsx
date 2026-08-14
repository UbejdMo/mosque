import { useTranslation } from 'react-i18next';
import type { HouseholdYearDto, YearStatus } from '@mosque/shared';
import { formatCentsPlain } from '../lib/format';
import { cn } from '../lib/cn';

/**
 * The year-by-year grid (SPEC §10).
 *
 * Status is carried by a written word as well as colour — the collector may be
 * colourblind, and this is read in bright sunlight where hue is unreliable.
 */
const STATUS_STYLES: Record<YearStatus, string> = {
  paid: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  partial: 'border-amber-300 bg-amber-50 text-amber-900',
  unpaid: 'border-red-300 bg-red-50 text-red-900',
  settled: 'border-slate-300 bg-slate-100 text-slate-600',
};

export function YearGrid({ years }: { years: HouseholdYearDto[] }) {
  const { t } = useTranslation();

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
      {years.map((year) => {
        const status = year.status;
        // Years before the household had anyone in it are shown flat, so the
        // eye is drawn only to years that mean something.
        const isEmpty = year.liablePersonCount === 0 && year.allocatedCents === 0;

        return (
          <li
            key={year.year}
            className={cn(
              'rounded-lg border px-3 py-2',
              isEmpty ? 'border-slate-200 bg-white text-slate-400' : STATUS_STYLES[status],
            )}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">{year.year}</span>
              <span className="text-xs">{isEmpty ? '—' : t(`yearStatus.${status}`)}</span>
            </div>

            {isEmpty ? null : (
              <div className="mt-1 text-sm tabular-nums">
                {year.status === 'partial' ? (
                  <span>
                    {formatCentsPlain(year.allocatedCents)} / {formatCentsPlain(year.obligationCents)}
                  </span>
                ) : (
                  <span>{formatCentsPlain(year.obligationCents)}</span>
                )}
              </div>
            )}

            {year.rateMissing && year.liablePersonCount > 0 ? (
              <p className="mt-1 text-xs text-amber-700">{t('household.rateMissing')}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
