import { useState } from 'react';
import { api } from '../api';
import type { DashboardData } from '../hooks/useDashboardData';
import type { PeriodId } from '../lib/period';
import { periodLabel, periodRange } from '../lib/period';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Kpi,
  PageHeader,
  SegmentedControl,
  Skeleton,
  SparkBar,
  Table,
  fmt,
  usd,
} from '../components/primitives';

type SpendTab = 'agent' | 'task' | 'project';

export function SpendPage({
  data,
  period,
  onError,
}: {
  data: DashboardData;
  period: PeriodId;
  onError: (message: string) => void;
}) {
  const [tab, setTab] = useState<SpendTab>('agent');

  if (data.loading) {
    return (
      <div>
        <PageHeader title="Spend" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const rows =
    tab === 'agent'
      ? data.agents.map((a) => [a.agentName, fmt(a.totalTokens), usd(a.costUsd), String(a.requests)])
      : tab === 'task'
        ? data.tasks.map((t) => [t.taskName, fmt(t.totalTokens), usd(t.costUsd), String(t.requests)])
        : data.projects.map((p) => [p.projectName, fmt(p.totalTokens), usd(p.costUsd), String(p.requests)]);

  const sparkSource =
    tab === 'agent' ? data.agents : tab === 'task' ? data.tasks : data.projects;
  const maxTok = Math.max(1, ...sparkSource.map((r) => r.totalTokens));

  return (
    <div>
      <PageHeader
        title="Spend"
        description={`Who and what burned tokens in ${periodLabel(period).toLowerCase()}.`}
        actions={
          <div className="flex flex-wrap gap-2">
            {(['agent', 'task', 'project', 'user'] as const).map((g) => (
              <Button
                key={g}
                variant="secondary"
                onClick={() =>
                  api.downloadChargebackCsv(g, periodRange(period)).catch((err) => onError((err as Error).message))
                }
              >
                CSV · {g}
              </Button>
            ))}
          </div>
        }
      />

      {data.error && (
        <div className="mb-4">
          <ErrorBanner message={data.error} onRetry={data.reload} />
        </div>
      )}

      <div className="mb-4">
        <SegmentedControl
          label="Spend dimension"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'agent', label: 'By agent' },
            { id: 'task', label: 'By task' },
            { id: 'project', label: 'By project' },
          ]}
        />
      </div>

      {data.costPerTask && (
        <div className="mb-4 max-w-xs">
          <Kpi
            label="Cost per completed task"
            value={data.costPerTask.costPerTaskUsd == null ? '—' : usd(data.costPerTask.costPerTaskUsd)}
            sub={`${data.costPerTask.completedTasks} completed · all-time`}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={tab === 'agent' ? 'By agent' : tab === 'task' ? 'By task' : 'By project'}>
          {sparkSource.length > 0 && (
            <ul className="mb-4 space-y-2">
              {sparkSource.slice(0, 6).map((row) => {
                const name =
                  'agentName' in row ? row.agentName : 'taskName' in row ? row.taskName : row.projectName;
                const key =
                  'agentId' in row
                    ? row.agentId ?? name
                    : 'taskId' in row
                      ? row.taskId ?? name
                      : row.projectId ?? name;
                return (
                  <li key={String(key)}>
                    <div className="mb-1 flex justify-between text-xs text-muted">
                      <span className="text-ink">{name}</span>
                      <span className="tabular-nums">{usd(row.costUsd)}</span>
                    </div>
                    <SparkBar value={row.totalTokens} max={maxTok} />
                  </li>
                );
              })}
            </ul>
          )}
          <Table
            head={['Name', 'Tokens', 'Cost', 'Reqs']}
            rows={rows}
            empty="No spend in this period. Run the demo or send traffic through the proxy."
          />
        </Card>

        <Card title="Most expensive prompts">
          {data.expensive.length === 0 ? (
            <EmptyState title="No prompts yet" body="Completed LLM calls will rank here by cost." />
          ) : (
            <Table
              head={['Model', 'Tokens', 'Cost']}
              rows={data.expensive.map((e) => [e.model, fmt(e.totalTokens), usd(e.costUsd)])}
            />
          )}
        </Card>

        <Card title="Inefficient loops">
          {data.loops.length === 0 ? (
            <EmptyState title="No loops detected" body="Repeated signatures in a session would show up here." />
          ) : (
            <Table
              head={['Session', 'Repeats']}
              rows={data.loops.map((l) => [
                l.sessionId ? `${l.sessionId.slice(0, 10)}…` : '—',
                String(l.repeats),
              ])}
            />
          )}
        </Card>

        <Card title="Savings ledger">
          {data.savings ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <p className="text-sm">
                  <span className="block text-xs text-muted">Estimated saved</span>
                  <span className="font-semibold tabular-nums">{usd(data.savings.totalSavedUsd)}</span>
                </p>
                <p className="text-sm">
                  <span className="block text-xs text-muted">Blocked</span>
                  <span className="font-semibold tabular-nums">{data.savings.blockedRequests}</span>
                </p>
                <p className="text-sm">
                  <span className="block text-xs text-muted">Optimized</span>
                  <span className="font-semibold tabular-nums">{data.savings.optimizedRequests}</span>
                </p>
                <p className="text-sm">
                  <span className="block text-xs text-muted">Tokens avoided</span>
                  <span className="font-semibold tabular-nums">{fmt(data.savings.totalSavedTokens)}</span>
                </p>
              </div>
              {data.savings.byDecision.length > 0 ? (
                <Table
                  head={['Decision', 'Events', 'Saved $', 'Saved tokens']}
                  rows={data.savings.byDecision.map((d) => [
                    d.decision,
                    String(d.count),
                    usd(d.savedUsd),
                    fmt(d.savedTokens),
                  ])}
                />
              ) : (
                <EmptyState
                  title="No policy-driven savings yet"
                  body="Blocked or optimized requests will appear in this ledger."
                />
              )}
              <p className="text-xs text-muted">{data.savings.note}</p>
            </div>
          ) : (
            <EmptyState title="Ledger unavailable" body="Savings are computed from policy events and usage." />
          )}
        </Card>
      </div>
    </div>
  );
}
