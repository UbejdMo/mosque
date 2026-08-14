import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * Login is phone + 6-digit PIN (SPEC §7).
 *
 * Built for a phone held outdoors: big inputs, a numeric keypad for the PIN,
 * and one clear error line rather than field-by-field scolding.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!/^\d{6}$/.test(pin)) {
      setError(t('login.errors.pinFormat'));
      return;
    }

    setSubmitting(true);
    try {
      await login(phone, pin);
    } catch (err) {
      setError(messageFor(err, t));
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-brand-900">{t('app.name')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('login.subtitle')}</p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="mb-5 text-lg font-medium">{t('login.title')}</h2>

          <label className="block text-sm font-medium text-slate-700" htmlFor="phone">
            {t('login.phone')}
          </label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder={t('login.phonePlaceholder')}
            className="tap-target mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
          />

          <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="pin">
            {t('login.pin')}
          </label>
          <input
            id="pin"
            type="password"
            /* Numeric keypad on a phone, and no autocorrect mangling the PIN. */
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="current-password"
            required
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            className="tap-target mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.5em] focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
          />

          {error ? (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="tap-target mt-6 w-full rounded-lg bg-brand-600 px-4 py-2 text-base font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {submitting ? t('login.submitting') : t('login.submit')}
          </button>
        </form>
      </div>
    </main>
  );
}

/**
 * Server messages are developer-facing English; the villager sees Albanian.
 * Mapping happens on the stable `code`, plus the few cases the API
 * distinguishes by status.
 */
function messageFor(error: unknown, t: TFunction): string {
  if (!(error instanceof ApiError)) return t('common.unexpectedError');

  if (error.code === 'unauthenticated') return t('login.errors.invalidCredentials');
  if (error.code === 'rate_limited') return t('login.errors.locked');
  if (error.code === 'forbidden') {
    return error.message.includes('waiting for approval')
      ? t('login.errors.pendingApproval')
      : t('login.errors.notActive');
  }
  return t('common.unexpectedError');
}
