import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatCents } from '../lib/format';
import { useHouseholds } from '../lib/ledger-api';

const ARREARS_THRESHOLD_YEARS = 3;

/**
 * The screen the collector lives in (SPEC §10): search by name, father's name
 * or neighbourhood, filter to the households worth visiting, sorted by what
 * they owe — which is the order he walks the village in.
 */
export function HouseholdListPage() {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [onlyArrears, setOnlyArrears] = useState(false);

  // Typing is faster than the network; wait for a pause before querying.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const households = useHouseholds({
    search,
    ...(onlyArrears ? { minYearsUnpaid: ARREARS_THRESHOLD_YEARS } : {}),
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="mb-4 text-xl font-semibold text-brand-900">{t('households.title')}</h1>

      <div className="mb-4 space-y-3">
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t('households.searchPlaceholder')}
          className="tap-target w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
        />

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={onlyArrears}
            onChange={(event) => setOnlyArrears(event.target.checked)}
            className="size-4 rounded border-slate-300"
          />
          {t('households.onlyArrears', { years: ARREARS_THRESHOLD_YEARS })}
        </label>
      </div>

      {households.isLoading ? (
        <p className="py-8 text-center text-slate-500">{t('common.loading')}</p>
      ) : households.data?.length === 0 ? (
        <p className="py-8 text-center text-slate-500">{t('households.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {households.data?.map((household) => (
            <li key={household.id}>
              <Link
                to={`/households/${household.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-brand-600"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {household.headName ?? t('households.noHead')}
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {[
                      household.neighbourhood,
                      t('households.members', { count: household.personCount }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {household.needsReview ? (
                    <span className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      {t('households.needsReview')}
                    </span>
                  ) : null}
                </div>

                <div className="shrink-0 text-right">
                  {household.balanceCents > 0 ? (
                    <>
                      <p className="font-semibold tabular-nums text-red-700">
                        {formatCents(household.balanceCents)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {t('households.yearsUnpaid', { count: household.yearsUnpaid })}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm font-medium text-emerald-700">
                      {t('households.settled')}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
