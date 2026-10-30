import React, { Suspense, lazy, useEffect } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CalendarClock, Home, Landmark, LineChart, Wallet } from 'lucide-react';
import { VaultProvider, useVault } from './vault';
import { Toaster } from './toast';
import { Onboarding } from './pages/Onboarding';
import { LockScreen } from './pages/Lock';
import { HomePage } from './pages/Home';
import { isIosBrowser, isStandalone, onBackButton } from '../platform/device';
import { InstallGate } from './pages/InstallGate';
import { cx } from './format';
import { OwnerProvider } from './owner';
import { ForwardedSms } from './components/ForwardedSms';

const InvestPage = lazy(() => import('./pages/Invest'));
const HoldingPage = lazy(() => import('./pages/Holding'));
const TaxPage = lazy(() => import('./pages/Tax'));
const ImportStatementPage = lazy(() => import('./pages/ImportStatement'));
const SpendPage = lazy(() => import('./pages/Spend'));
const ImportBankPage = lazy(() => import('./pages/ImportBank'));
const LoansPage = lazy(() => import('./pages/Loans'));
const LoanPage = lazy(() => import('./pages/Loan'));
const SimulatorPage = lazy(() => import('./pages/Simulator'));
const PlanPage = lazy(() => import('./pages/Plan'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const BackupPage = lazy(() => import('./pages/Backup'));
const SearchPage = lazy(() => import('./pages/Search'));

const TABS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/invest', label: 'Invest', icon: LineChart },
  { to: '/spend', label: 'Spend', icon: Wallet },
  { to: '/loans', label: 'Loans', icon: Landmark },
  { to: '/plan', label: 'Plan', icon: CalendarClock },
];

const TabBar: React.FC = () => (
  <nav className="fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-neutral-950/95 backdrop-blur border-t border-neutral-200 dark:border-neutral-800" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
    <div className="max-w-2xl mx-auto grid grid-cols-5">
      {TABS.map(t => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('h-16 flex flex-col items-center justify-center gap-1 text-[11px] font-medium', isActive ? 'text-primary-600 dark:text-primary-400' : 'text-neutral-500')}>
          <t.icon size={22} strokeWidth={2} />
          {t.label}
        </NavLink>
      ))}
    </div>
  </nav>
);

/** Android back button: go back in-app, minimise at a tab root. */
const BackHandler: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => onBackButton(() => {
    if (document.querySelector('[role="dialog"]')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return true;
    }
    if (TABS.some(t => t.to === location.pathname)) return false;
    navigate(-1);
    return true;
  }), [navigate, location.pathname]);
  return null;
};

const Loading = () => <div className="h-full flex items-center justify-center"><div className="h-8 w-8 rounded-full border-2 border-primary-600 border-t-transparent animate-spin" /></div>;

const Unlocked: React.FC = () => (
  <OwnerProvider>
    <HashRouter>
      <BackHandler />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/invest" element={<InvestPage />} />
          <Route path="/invest/tax" element={<TaxPage />} />
          <Route path="/invest/import" element={<ImportStatementPage />} />
          <Route path="/invest/:id" element={<HoldingPage />} />
          <Route path="/spend" element={<SpendPage />} />
          <Route path="/spend/import" element={<ImportBankPage />} />
          <Route path="/loans" element={<LoansPage />} />
          <Route path="/loans/:id" element={<LoanPage />} />
          <Route path="/loans/:id/simulate" element={<SimulatorPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/backup" element={<BackupPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <TabBar />
      <ForwardedSms />
    </HashRouter>
  </OwnerProvider>
);

const Gate: React.FC = () => {
  const { phase } = useVault();
  if (phase === 'loading') return <Loading />;
  if (phase === 'new') return isIosBrowser() && !isStandalone() ? <InstallGate /> : <Onboarding />;
  if (phase === 'locked') return <LockScreen />;
  return <Unlocked />;
};

export default function App() {
  return (
    <VaultProvider>
      <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
        <Gate />
      </div>
      <Toaster />
    </VaultProvider>
  );
}
