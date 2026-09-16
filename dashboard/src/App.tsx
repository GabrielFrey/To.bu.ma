import { useCallback, useEffect, useState } from 'react';
import { getApiKey } from './api';
import { AppShell } from './components/layout/AppShell';
import { useDashboardData } from './hooks/useDashboardData';
import { hashForView, viewFromHash, type ViewId } from './lib/nav';
import type { PeriodId } from './lib/period';
import { OverviewPage } from './views/OverviewPage';
import { SpendPage } from './views/SpendPage';
import { BudgetsPage } from './views/BudgetsPage';
import { PoliciesPage } from './views/PoliciesPage';
import { RequestsPage } from './views/RequestsPage';
import { AssistantPage } from './views/AssistantPage';
import { SettingsPage } from './views/SettingsPage';

export default function App() {
  const [view, setViewState] = useState<ViewId>(() =>
    typeof window === 'undefined' ? 'overview' : viewFromHash()
  );
  const [period, setPeriod] = useState<PeriodId>('30d');
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const pausePolling = view === 'assistant' || assistantOpen;
  const data = useDashboardData(period, pausePolling);

  const setView = useCallback((id: ViewId) => {
    setViewState(id);
    if (id === 'assistant') setAssistantOpen(false);
    window.location.hash = hashForView(id);
  }, []);

  useEffect(() => {
    const onHash = () => setViewState(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tenantLabel = 'Local tenant';
  const envLabel = import.meta.env.DEV ? 'Development' : 'Production';
  const keyHint = getApiKey() ? `key ${getApiKey().slice(0, 12)}…` : 'no API key';

  return (
    <AppShell
      view={view}
      onView={setView}
      period={period}
      onPeriod={setPeriod}
      navOpen={navOpen}
      onNavOpen={setNavOpen}
      searchOpen={searchOpen}
      onSearchOpen={setSearchOpen}
      assistantOpen={assistantOpen}
      onAssistantOpen={setAssistantOpen}
      tenantLabel={`${tenantLabel} · ${keyHint}`}
      envLabel={envLabel}
      data={data}
      onMutated={() => void data.reload()}
    >
      {banner && (
        <p className="mb-4 text-sm text-danger-ink" role="status">
          {banner}
        </p>
      )}
      {view === 'overview' && (
        <OverviewPage
          data={data}
          period={period}
          onView={setView}
          onAsk={() => {
            setView('assistant');
          }}
        />
      )}
      {view === 'spend' && (
        <SpendPage data={data} period={period} onError={setBanner} />
      )}
      {view === 'budgets' && <BudgetsPage data={data} onError={setBanner} />}
      {view === 'policies' && (
        <PoliciesPage data={data} period={period} onError={setBanner} />
      )}
      {view === 'requests' && <RequestsPage data={data} period={period} />}
      {view === 'assistant' && <AssistantPage onMutated={() => void data.reload()} />}
      {view === 'settings' && <SettingsPage onApplied={() => void data.reload()} />}
    </AppShell>
  );
}
