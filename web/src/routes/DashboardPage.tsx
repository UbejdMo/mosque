import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';

/**
 * Placeholder. The real dashboard (SPEC §10) shows what was collected this
 * month, the current batch status, how many households are in arrears and the
 * pending-approvals badge — all of which need endpoints that do not exist yet.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">{t('dashboard.title')}</h1>
          {user ? (
            <p className="text-sm text-slate-600">
              {t('dashboard.signedInAs', { role: t(`roles.${user.role}`) })}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="tap-target rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100"
        >
          {t('nav.logout')}
        </button>
      </header>

      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
        {t('app.tagline')}
      </div>
    </main>
  );
}
