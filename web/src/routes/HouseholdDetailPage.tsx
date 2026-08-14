import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatCents, formatDate } from '../lib/format';
import { useHousehold } from '../lib/ledger-api';
import { YearGrid } from '../components/YearGrid';
import { useAuth } from '../lib/auth';

/**
 * One household, in full (SPEC §10): who is in it, the year grid, and every
 * payment with its receipt number.
 *
 * Note what is deliberately absent: no eligibility badge, no comparison with
 * any other household. The app shows the balance and leaves the rest to people.
 */
export function HouseholdDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const household = useHousehold(id);

  const isStaff = user?.role !== 'member';

  if (household.isLoading) {
    return <p className="py-10 text-center text-slate-500">{t('common.loading')}</p>;
  }
  if (!household.data) {
    return <p className="py-10 text-center text-slate-500">{t('common.unexpectedError')}</p>;
  }

  const { household: summary, persons, years, payments } = household.data;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      {isStaff ? (
        <Link to="/households" className="text-sm text-brand-700 hover:underline">
          ← {t('household.back')}
        </Link>
      ) : null}

      <header className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">
            {summary.headName ?? t('households.noHead')}
          </h1>
          <p className="text-sm text-slate-500">
            {[summary.neighbourhood, summary.phone].filter(Boolean).join(' · ')}
          </p>
        </div>

        <div className="text-right">
          <p className="text-sm text-slate-500">{t('households.owes')}</p>
          <p
            className={
              summary.balanceCents > 0
                ? 'text-2xl font-semibold tabular-nums text-red-700'
                : 'text-2xl font-semibold tabular-nums text-emerald-700'
            }
          >
            {formatCents(summary.balanceCents)}
          </p>
        </div>
      </header>

      {isStaff ? (
        <Link
          to={`/households/${summary.id}/payments/new`}
          className="tap-target mb-6 inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
        >
          {t('household.recordPayment')}
        </Link>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
          {t('household.members')}
        </h2>
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {persons.map((person) => (
            <li key={person.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                {/* Albanian convention: given name, father's name, surname. */}
                <p className="font-medium">
                  {person.firstName} {person.fatherName} {person.lastName}
                </p>
                <p className="text-sm text-slate-500">
                  {person.leftYear === null
                    ? t('household.joined', { year: person.joinedYear })
                    : t('household.period', { from: person.joinedYear, to: person.leftYear })}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {person.isHead ? (
                  <span className="rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
                    {t('household.head')}
                  </span>
                ) : null}
                {/* Living abroad is shown, but it is not an exemption (SPEC §5.2). */}
                {person.livesAbroad ? (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {t('household.livesAbroad')}
                  </span>
                ) : null}
                {person.leftYear !== null ? (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {t('household.left', { year: person.leftYear })}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
          {t('household.yearGrid')}
        </h2>
        <YearGrid years={years} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
          {t('household.paymentHistory')}
        </h2>
        {payments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-slate-500">
            {t('household.noPayments')}
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {payments.map((payment) => (
              <li key={payment.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{formatDate(payment.paidAt)}</span>
                  <span className="font-semibold tabular-nums">
                    {formatCents(payment.totalCents)}
                  </span>
                </div>
                <p className="text-sm text-slate-500">
                  {t('household.receipt', { number: payment.receiptNumber })}
                  {' · '}
                  {payment.allocations.map((allocation) => allocation.year).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
