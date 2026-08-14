import { Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './routes/LoginPage';
import { HouseholdListPage } from './routes/HouseholdListPage';
import { HouseholdDetailPage } from './routes/HouseholdDetailPage';
import { RecordPaymentPage } from './routes/RecordPaymentPage';
import { ImportPage } from './routes/ImportPage';

export function App() {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        {t('common.loading')}
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  /**
   * A member's whole app is their own household (SPEC §10). They get no
   * household list — not an empty one, none at all.
   */
  if (user.role === 'member') {
    return (
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/household" element={<HouseholdDetailPage />} />
          <Route
            path="*"
            element={<Navigate to={`/households/${user.householdId ?? ''}`} replace />}
          />
          <Route path="/households/:id" element={<HouseholdDetailPage />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/households" element={<HouseholdListPage />} />
        <Route path="/households/:id" element={<HouseholdDetailPage />} />
        <Route path="/households/:id/payments/new" element={<RecordPaymentPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="*" element={<Navigate to="/households" replace />} />
      </Route>
    </Routes>
  );
}
