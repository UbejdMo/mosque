import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api';
import { formatCents, formatCentsPlain, parseCents, todayIso } from '../lib/format';
import { useAllocationPreview, useHousehold, useRecordPayment } from '../lib/ledger-api';

interface AllocationRow {
  year: number;
  amountCents: number;
}

/**
 * Recording a cash payment (SPEC §5.5, §10).
 *
 * The FIFO split is shown before saving and is editable — the collector
 * sometimes knows "this €50 is for 2025 specifically".
 */
export function RecordPaymentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: householdId = '' } = useParams<{ id: string }>();

  const household = useHousehold(householdId);
  const recordPayment = useRecordPayment();

  const [amountInput, setAmountInput] = useState('');
  const [paidAt, setPaidAt] = useState(todayIso());
  const [receiptNumber, setReceiptNumber] = useState('');
  const [note, setNote] = useState('');
  const [allocations, setAllocations] = useState<AllocationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Generated once, before the payment is ever sent. If the request is retried
   * — a flaky courtyard signal, a double tap — the server matches this and
   * records one payment, not two (SPEC §9).
   */
  const clientUuid = useRef(crypto.randomUUID());

  const totalCents = parseCents(amountInput);
  const preview = useAllocationPreview(householdId, totalCents);

  // The server's proposal is the starting point; edits below replace it.
  useEffect(() => {
    if (preview.data) setAllocations(preview.data.allocations);
  }, [preview.data]);

  const allocatedCents = (allocations ?? []).reduce((sum, row) => sum + row.amountCents, 0);
  const matchesTotal = totalCents !== null && allocatedCents === totalCents;
  const canSubmit =
    totalCents !== null && totalCents > 0 && receiptNumber.trim() !== '' && matchesTotal;

  function updateAllocation(year: number, value: string) {
    const cents = parseCents(value) ?? 0;
    setAllocations((rows) =>
      (rows ?? []).map((row) => (row.year === year ? { ...row, amountCents: cents } : row)),
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (totalCents === null || !allocations) return;

    try {
      const result = await recordPayment.mutateAsync({
        householdId,
        totalCents,
        paidAt,
        receiptNumber: receiptNumber.trim(),
        clientUuid: clientUuid.current,
        ...(note.trim() ? { note: note.trim() } : {}),
        // Only send a split when it differs from what the server proposed;
        // otherwise let the server run FIFO itself.
        allocations: allocations.filter((row) => row.amountCents > 0),
      });

      void navigate(`/households/${householdId}`, {
        state: {
          flash: result.replayed ? 'payment.alreadyRecorded' : 'payment.saved',
          warning: result.duplicateReceipt ? 'payment.duplicateReceipt' : null,
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.unexpectedError'));
    }
  }

  const owes = household.data?.household.balanceCents ?? 0;

  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <Link to={`/households/${householdId}`} className="text-sm text-brand-700 hover:underline">
        ← {t('household.back')}
      </Link>

      <h1 className="mt-3 mb-1 text-xl font-semibold text-brand-900">{t('payment.title')}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {household.data?.household.headName} · {t('households.owes')} {formatCents(owes)}
      </p>

      {owes === 0 ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {t('payment.nothingOwed')}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="amount">
            {t('payment.amount')}
          </label>
          <input
            id="amount"
            inputMode="decimal"
            required
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            placeholder="0,00"
            className="tap-target mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-lg tabular-nums focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="paidAt">
              {t('payment.date')}
            </label>
            <input
              id="paidAt"
              type="date"
              required
              value={paidAt}
              onChange={(event) => setPaidAt(event.target.value)}
              className="tap-target mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="receipt">
              {t('payment.receiptNumber')}
            </label>
            <input
              id="receipt"
              required
              value={receiptNumber}
              onChange={(event) => setReceiptNumber(event.target.value)}
              className="tap-target mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <p className="mt-1 text-xs text-slate-500">{t('payment.receiptHint')}</p>
          </div>
        </div>

        {allocations && allocations.length > 0 ? (
          <fieldset className="rounded-xl border border-slate-200 bg-white p-4">
            <legend className="px-1 text-sm font-medium text-slate-700">
              {t('payment.allocation')}
            </legend>
            <p className="mb-3 text-xs text-slate-500">{t('payment.allocationHint')}</p>

            <ul className="space-y-2">
              {allocations.map((row) => (
                <li key={row.year} className="flex items-center gap-3">
                  <span className="w-16 text-sm font-medium tabular-nums">{row.year}</span>
                  <input
                    inputMode="decimal"
                    aria-label={String(row.year)}
                    value={formatCentsPlain(row.amountCents)}
                    onChange={(event) => updateAllocation(row.year, event.target.value)}
                    className="tap-target w-full rounded-lg border border-slate-300 px-3 py-2 text-right tabular-nums"
                  />
                </li>
              ))}
            </ul>

            {preview.data && preview.data.unallocatedCents > 0 ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {t('payment.unallocated', {
                  amount: formatCents(preview.data.unallocatedCents),
                })}
              </p>
            ) : null}

            {!matchesTotal && totalCents !== null ? (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {t('payment.mismatch', { amount: formatCents(totalCents) })}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="note">
            {t('payment.note')}
          </label>
          <input
            id="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="tap-target mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit || recordPayment.isPending}
          className="tap-target w-full rounded-lg bg-brand-600 px-4 py-2 text-base font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {recordPayment.isPending ? t('payment.submitting') : t('payment.submit')}
        </button>
      </form>
    </main>
  );
}
