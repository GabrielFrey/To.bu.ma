import type { ViewId } from '../lib/nav';
import type { PeriodId } from '../lib/period';
import { periodLabel } from '../lib/period';
import type { DashboardData } from '../hooks/useDashboardData';
import {
  Badge,
  BudgetBar,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Kpi,
  PageHeader,
  Skeleton,
  SparkBar,
  fmt,
  pct,
  usd,
} from '../components/primitives';
import { cn } from '../lib/cn';

export function OverviewPage({
  data,
  period,
  onView,
  onAsk,
}: {
  data: DashboardData;
  period: PeriodId;
  onView: (id: ViewId) => void;
  onAsk: () => void;
}) {
  const tightest = data.budgets[0];
  const topAgents = [...data.agents].slice(0, 5);
  const maxTok = Math.max(1, ...topAgents.map((a) => a.totalTokens));
  const alerts = [
    ...data.budgets.filter((b) => b.exceedsHard || b.exceedsSoft || b.atWarning),
    ...data.blocked.slice(0, 3),
  ];

  if (data.loading) {
    return (
      <div>
        <PageHeader title="Overview" description="How much, who, and whether a limit is close." />
        <div className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Overview"
        description={`Spend and limits for ${periodLabel(period).toLowerCase()}.`}
        actions={
          <Button variant="secondary" onClick={onAsk}>
            Ask assistant
          </Button>
        }
      />

      {data.error && (
        <div className="mb-4">
          <ErrorBanner
            message={`Cannot reach the API: ${data.error}. Start the backend on :4000 and check the key in Settings.`}
            onRetry={data.reload}
          />
        </div>
      )}

      <div className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
        <Kpi
          label="Tokens"
          value={data.total ? fmt(data.total.totalTokens) : '—'}
          sub={data.total ? `${fmt(data.total.inputTokens)} in · ${fmt(data.total.outputTokens)} out` : undefined}
        />
        <Kpi label="Spend" value={data.total ? usd(data.total.costUsd) : '—'} sub="USD this period" />
        <Kpi label="Requests" value={data.total ? fmt(data.total.requests) : '—'} sub="LLM calls accounted" />
        <Kpi
          label="Blocked"
          value={fmt(data.blocked.length)}
          sub="Hard stops and gates"
          tone={data.blocked.length > 0 ? 'danger' : 'default'}
        />
        <Kpi
          label="Tightest budget"
          value={tightest ? pct(tightest.utilization) : '—'}
          sub={tightest ? tightest.name : 'No active budgets'}
          tone={
            tightest?.exceedsHard ? 'danger' : tightest?.atWarning || tightest?.exceedsSoft ? 'warning' : 'default'
          }
        />
      </div>

      {data.assistantSpend && (
        <button
          type="button"
          onClick={() => onView('assistant')}
          className={cn(
            'mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs',
            'hover:bg-surface-muted',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring'
          )}
        >
          <span className="font-medium text-ink-strong">Assistant spend</span>
          <span className="text-muted">
            {fmt(data.assistantSpend.totalTokens)} tok · {usd(data.assistantSpend.costUsd)}
          </span>
          {data.assistantSpend.paused && <Badge text="paused" tone="danger" />}
        </button>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Limits at risk"
          action={
            <Button variant="ghost" onClick={() => onView('budgets')}>
              Budgets
            </Button>
          }
        >
          {data.budgets.length === 0 ? (
            <EmptyState
              title="No budgets yet"
              body="Import a policy pack or ask the assistant to create a cap."
              action={
                <Button variant="secondary" onClick={() => onView('budgets')}>
                  Open budgets
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {data.budgets.slice(0, 4).map((b) => (
                <div key={b.budgetId}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium">
                      {b.name}{' '}
                      <span className="font-normal text-muted">({b.level.toLowerCase()})</span>
                    </span>
                    <span className="tabular-nums text-muted">{pct(b.utilization)}</span>
                  </div>
                  <BudgetBar
                    utilization={b.utilization}
                    softRatio={b.softLimit != null && b.hardLimit > 0 ? b.softLimit / b.hardLimit : null}
                    name={b.name}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Who is burning it"
          action={
            <Button variant="ghost" onClick={() => onView('spend')}>
              Spend
            </Button>
          }
        >
          {topAgents.length === 0 ? (
            <EmptyState
              title="No spend yet"
              body="Run traffic through the proxy or `npm run demo` in backend/."
            />
          ) : (
            <ul className="space-y-3">
              {topAgents.map((a) => (
                <li key={a.agentId ?? a.agentName}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium">{a.agentName}</span>
                    <span className="tabular-nums text-muted">
                      {fmt(a.totalTokens)} · {usd(a.costUsd)}
                    </span>
                  </div>
                  <SparkBar value={a.totalTokens} max={maxTok} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="What to do next"
          action={
            <Button variant="ghost" onClick={onAsk}>
              Ask
            </Button>
          }
        >
          {data.recs.length === 0 ? (
            <EmptyState title="Nothing urgent" body="No optimization recommendations for this period." />
          ) : (
            <ul className="space-y-2">
              {data.recs.map((r) => (
                <li
                  key={`${r.type}-${r.message}`}
                  className={cn(
                    'rounded-md p-2 text-sm',
                    r.severity === 'warn' ? 'bg-warning-soft text-warning-ink' : 'bg-surface-muted text-ink'
                  )}
                >
                  <span className="font-medium">{r.type}:</span> {r.message}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Alerts"
          action={
            <Button variant="ghost" onClick={() => onView('requests')}>
              Requests
            </Button>
          }
        >
          {alerts.length === 0 ? (
            <EmptyState title="Quiet" body="No budgets at warning and no blocked calls in this period." />
          ) : (
            <ul className="space-y-2">
              {data.budgets
                .filter((b) => b.exceedsHard || b.exceedsSoft || b.atWarning)
                .map((b) => (
                  <li key={b.budgetId} className="flex items-start gap-2 text-sm">
                    <Badge
                      text={b.exceedsHard ? 'hard limit' : b.exceedsSoft ? 'soft limit' : 'warning'}
                    />
                    <span>
                      {b.name} is at {pct(b.utilization)}
                    </span>
                  </li>
                ))}
              {data.blocked.slice(0, 4).map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-sm">
                  <Badge text={e.decision} />
                  <span className="text-ink">{e.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
