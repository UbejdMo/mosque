import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from '@mosque/shared';
import { useAuth } from '../lib/auth';
import { setLocale } from '../i18n';
import { cn } from '../lib/cn';

/**
 * Frame for the signed-in app. Members see only their own household, so the
 * navigation they get is deliberately narrower — there is no screen anywhere
 * that compares one household to another (SPEC hard product rule 2).
 */
export function AppShell() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const isStaff = user?.role === 'collector' || user?.role === 'imam' || user?.role === 'super_admin';

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <span className="font-semibold text-brand-900">{t('app.name')}</span>

          <nav className="flex items-center gap-1">
            {isStaff ? (
              <NavLink
                to="/households"
                className={({ isActive }) =>
                  cn(
                    'tap-target rounded-lg px-3 py-2 text-sm font-medium',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
                  )
                }
              >
                {t('nav.households')}
              </NavLink>
            ) : null}

            <select
              aria-label="Language"
              value={i18n.language}
              onChange={(event) => setLocale(event.target.value as Locale)}
              className="tap-target rounded-lg border border-slate-300 px-2 py-1 text-sm"
            >
              {LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {locale.toUpperCase()}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void logout()}
              className="tap-target rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              {t('nav.logout')}
            </button>
          </nav>
        </div>
      </header>

      <Outlet />
    </div>
  );
}
