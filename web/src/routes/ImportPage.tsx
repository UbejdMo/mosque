import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api';
import { cn } from '../lib/cn';
import { csvToHouseholds, CsvError } from '../lib/csv';
import { useImportHouseholds, useNeighbourhoods, type ImportPerson } from '../lib/import-api';

/**
 * Transcribing the paper notebook (SPEC §15).
 *
 * ~500 households × ~15 years of ticks, copied by hand from handwriting. This
 * screen is built for the person doing the five hundredth one: the cursor lands
 * where it is needed, the neighbourhood carries over, years toggle with a tap
 * or the space bar, and Ctrl+Enter saves and starts the next household without
 * touching the mouse.
 */

const LEDGER_START_YEAR = 2016;

interface DraftPerson extends ImportPerson {
  key: string;
}

function emptyPerson(isHead = false): DraftPerson {
  return {
    key: crypto.randomUUID(),
    firstName: '',
    fatherName: '',
    lastName: '',
    joinedYear: LEDGER_START_YEAR,
    isHead,
  };
}

export function ImportPage() {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();
  const years = Array.from(
    { length: currentYear - LEDGER_START_YEAR + 1 },
    (_, index) => LEDGER_START_YEAR + index,
  );

  const importHouseholds = useImportHouseholds();
  const neighbourhoods = useNeighbourhoods();

  const [neighbourhood, setNeighbourhood] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const [persons, setPersons] = useState<DraftPerson[]>([emptyPerson(true)]);
  const [settledYears, setSettledYears] = useState<number[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Ctrl+Enter saves from anywhere on the form — the transcriber's hands never
  // have to leave the keyboard.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        document.querySelector<HTMLFormElement>('#import-form')?.requestSubmit();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function toggleYear(year: number) {
    setSettledYears((current) =>
      current.includes(year) ? current.filter((value) => value !== year) : [...current, year],
    );
  }

  function updatePerson(key: string, patch: Partial<DraftPerson>) {
    setPersons((current) =>
      current.map((person) => (person.key === key ? { ...person, ...patch } : person)),
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const head = persons.find((person) => person.isHead) ?? persons[0];

    try {
      await importHouseholds.mutateAsync([
        {
          neighbourhood: neighbourhood || null,
          phone: phone || null,
          notes: notes || null,
          needsReview,
          persons: persons.map(({ key: _key, ...person }) => person),
          settledYears: [...settledYears].sort((a, b) => a - b),
        },
      ]);

      setSavedCount((count) => count + 1);
      setLastSaved(head ? `${head.firstName} ${head.lastName}`.trim() : null);

      // Reset for the next household, but keep the neighbourhood: the notebook
      // is ordered by lagja, so it is the same for a long run of entries.
      setPersons([emptyPerson(true)]);
      setSettledYears([]);
      setPhone('');
      setNotes('');
      setNeedsReview(false);
      firstFieldRef.current?.focus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.unexpectedError'));
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-brand-900">{t('import.title')}</h1>
        <p className="text-sm text-slate-500">{t('import.subtitle')}</p>
        {savedCount > 0 ? (
          <p className="mt-2 text-sm text-emerald-700">
            {t('import.savedCount', { count: savedCount })}
            {lastSaved ? ` · ${t('import.lastSaved', { name: lastSaved })}` : ''}
          </p>
        ) : null}
      </header>

      <form
        id="import-form"
        onSubmit={handleSubmit}
        className="space-y-5 rounded-xl border border-slate-200 bg-white p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium" htmlFor="neighbourhood">
              {t('common.neighbourhood')}
            </label>
            <input
              id="neighbourhood"
              list="neighbourhoods"
              value={neighbourhood}
              onChange={(event) => setNeighbourhood(event.target.value)}
              className="tap-target mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <datalist id="neighbourhoods">
              {neighbourhoods.data?.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="phone">
              {t('common.phone')}
            </label>
            <input
              id="phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="tap-target mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">{t('import.members')}</legend>
          <ul className="mt-2 space-y-2">
            {persons.map((person, index) => (
              <li key={person.key} className="grid grid-cols-12 gap-2">
                <input
                  ref={index === 0 ? firstFieldRef : undefined}
                  aria-label={t('import.firstName')}
                  placeholder={t('import.firstName')}
                  required
                  value={person.firstName}
                  onChange={(event) => updatePerson(person.key, { firstName: event.target.value })}
                  className="tap-target col-span-3 rounded-lg border border-slate-300 px-2 py-2"
                />
                <input
                  aria-label={t('import.fatherName')}
                  placeholder={t('import.fatherName')}
                  required
                  value={person.fatherName}
                  onChange={(event) => updatePerson(person.key, { fatherName: event.target.value })}
                  className="tap-target col-span-3 rounded-lg border border-slate-300 px-2 py-2"
                />
                <input
                  aria-label={t('import.lastName')}
                  placeholder={t('import.lastName')}
                  required
                  value={person.lastName}
                  onChange={(event) => updatePerson(person.key, { lastName: event.target.value })}
                  className="tap-target col-span-3 rounded-lg border border-slate-300 px-2 py-2"
                />
                <input
                  aria-label={t('import.joinedYear')}
                  type="number"
                  inputMode="numeric"
                  required
                  value={person.joinedYear}
                  onChange={(event) =>
                    updatePerson(person.key, { joinedYear: Number(event.target.value) })
                  }
                  className="tap-target col-span-2 rounded-lg border border-slate-300 px-2 py-2 tabular-nums"
                />
                <div className="col-span-1 flex items-center justify-center">
                  <input
                    type="radio"
                    name="head"
                    aria-label={t('import.head')}
                    checked={person.isHead ?? false}
                    onChange={() =>
                      setPersons((current) =>
                        current.map((row) => ({ ...row, isHead: row.key === person.key })),
                      )
                    }
                    className="size-4"
                  />
                </div>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setPersons((current) => [...current, emptyPerson()])}
            className="tap-target mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
          >
            + {t('import.addMember')}
          </button>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">{t('import.paidYears')}</legend>
          <p className="mb-2 text-xs text-slate-500">{t('import.paidYearsHint')}</p>
          <div className="flex flex-wrap gap-2">
            {years.map((year) => {
              const selected = settledYears.includes(year);
              return (
                <button
                  key={year}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleYear(year)}
                  className={cn(
                    'tap-target rounded-lg border px-3 py-2 text-sm tabular-nums',
                    selected
                      ? 'border-emerald-500 bg-emerald-50 font-semibold text-emerald-800'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {year}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium" htmlFor="notes">
              {t('import.notes')}
            </label>
            <input
              id="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="tap-target mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={needsReview}
              onChange={(event) => setNeedsReview(event.target.checked)}
              className="size-4 rounded border-slate-300"
            />
            {/* The notebook contradicts itself; flag it, do not stop (SPEC §15). */}
            {t('import.needsReview')}
          </label>
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {t('import.errorPrefix')}: {error}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={importHouseholds.isPending}
            className="tap-target rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {importHouseholds.isPending ? t('import.saving') : t('import.save')}
          </button>
          <span className="text-xs text-slate-500">{t('import.shortcuts')}</span>
        </div>
      </form>

      <CsvImport />
    </main>
  );
}

/** The spreadsheet path, for anyone who would rather prepare it in Excel. */
function CsvImport() {
  const { t } = useTranslation();
  const importHouseholds = useImportHouseholds();
  const [parsed, setParsed] = useState<{ households: number; persons: number } | null>(null);
  const [payload, setPayload] = useState<ReturnType<typeof csvToHouseholds>['households']>([]);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setImported(null);
    try {
      const result = csvToHouseholds(await file.text());
      setPayload(result.households);
      setParsed({ households: result.households.length, persons: result.personCount });
    } catch (err) {
      setPayload([]);
      setParsed(null);
      setError(
        err instanceof CsvError
          ? t('import.csv.parseError', { line: err.line, message: err.message })
          : t('common.unexpectedError'),
      );
    }
  }

  async function handleImport() {
    setError(null);
    try {
      // The endpoint caps a batch at 200 households, so a full notebook goes
      // up in chunks rather than one enormous request.
      let total = 0;
      for (let index = 0; index < payload.length; index += 100) {
        const chunk = payload.slice(index, index + 100);
        await importHouseholds.mutateAsync(chunk);
        total += chunk.length;
      }
      setImported(total);
      setParsed(null);
      setPayload([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.unexpectedError'));
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{t('import.csv.title')}</h2>
      <p className="mt-1 mb-3 text-xs text-slate-500">{t('import.csv.hint')}</p>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
        className="block w-full text-sm"
      />

      {parsed ? (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-sm text-slate-600">{t('import.csv.parsed', parsed)}</span>
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={importHouseholds.isPending}
            className="tap-target rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {importHouseholds.isPending ? t('import.csv.importing') : t('import.csv.import')}
          </button>
        </div>
      ) : null}

      {imported !== null ? (
        <p className="mt-3 text-sm text-emerald-700">
          {t('import.csv.imported', { count: imported })}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
