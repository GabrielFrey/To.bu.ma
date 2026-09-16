import type { ReactNode } from 'react';
import type { ViewId } from '../../lib/nav';
import type { PeriodId } from '../../lib/period';
import type { DashboardData } from '../../hooks/useDashboardData';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CommandSearch } from './CommandSearch';
import { AssistantDrawer } from './AssistantDrawer';

export function AppShell({
  view,
  onView,
  period,
  onPeriod,
  navOpen,
  onNavOpen,
  searchOpen,
  onSearchOpen,
  assistantOpen,
  onAssistantOpen,
  tenantLabel,
  envLabel,
  data,
  onMutated,
  children,
}: {
  view: ViewId;
  onView: (id: ViewId) => void;
  period: PeriodId;
  onPeriod: (id: PeriodId) => void;
  navOpen: boolean;
  onNavOpen: (open: boolean) => void;
  searchOpen: boolean;
  onSearchOpen: (open: boolean) => void;
  assistantOpen: boolean;
  onAssistantOpen: (open: boolean) => void;
  tenantLabel: string;
  envLabel: string;
  data: DashboardData;
  onMutated: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-surface-muted">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <Sidebar view={view} onView={onView} open={navOpen} onClose={() => onNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          period={period}
          onPeriod={onPeriod}
          tenantLabel={tenantLabel}
          envLabel={envLabel}
          lastUpdated={data.lastUpdated}
          onMenu={() => onNavOpen(true)}
          onSearch={() => onSearchOpen(true)}
          onAssistant={() => {
            if (view === 'assistant') return;
            onAssistantOpen(!assistantOpen);
          }}
          assistantOpen={assistantOpen}
        />
        <main id="main" className="flex-1 px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
      <CommandSearch
        open={searchOpen}
        onClose={() => onSearchOpen(false)}
        onNavigate={onView}
        data={data}
      />
      {view !== 'assistant' && (
        <AssistantDrawer
          open={assistantOpen}
          onClose={() => onAssistantOpen(false)}
          onMutated={onMutated}
        />
      )}
    </div>
  );
}
