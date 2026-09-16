import { useState } from 'react';
import { api } from '../api';
import type { DashboardData } from '../hooks/useDashboardData';
import {
  Badge,
  BudgetBar,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Skeleton,
  fmt,
  metricUnit,
  pct,
  usd,
} from '../components/primitives';

export function BudgetsPage({
  data,
  onError,
}: {
  data: DashboardData;
  onError: (message: string) => void;
}) {
  const [packStatus, setPackStatus] = useState<string | null>(null);

  if (data.loading) {
    return (
      <div>
        <PageHeader title="Budgets" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  const recordById = new Map(data.budgetRecords.map((b) => [b.id, b]));

  return (
    <div>
      <PageHeader
        title="Budgets"
        description="Utilization against soft and hard limits. Create and edit from the assistant or API."
      />

      {data.error && (
        <div className="mb-4">
          <ErrorBanner message={data.error} onRetry={data.reload} />
        </div>
      )}

      {data.budgets.length === 0 ? (
        <Card title="Active budgets">
          <EmptyState
            title="No budgets defined"
            body="Import a built-in pack to get a starting cap, or ask the assistant to create one."
          />
        </Card>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.budgets.map((b) => {
            const rec = recordById.get(b.budgetId);
            const reset = b.resetPeriod ?? rec?.resetPeriod ?? '—';
            const soft = b.softLimit ?? rec?.softLimit ?? null;
            const used = b.used + b.reserved;
            return (
              <Card
                key={b.budgetId}
                title={b.name}
                action={
                  <Badge
                    text={b.exceedsHard ? 'hard' : b.exceedsSoft ? 'soft' : b.atWarning ? 'warning' : 'ok'}
                  />
                }
              >
                <p className="mb-3 text-xs text-muted">
                  {b.level.toLowerCase()} · {b.metric === 'COST_USD' ? 'USD' : 'tokens'} · resets{' '}
                  {String(reset).toLowerCase()}
                </p>
                <BudgetBar
                  utilization={b.utilization}
                  softRatio={soft != null && b.hardLimit > 0 ? soft / b.hardLimit : null}
                  name={b.name}
                />
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Used + reserved</dt>
                    <dd className="tabular-nums">
                      {b.metric === 'COST_USD' ? usd(used) : fmt(Math.round(used))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Hard limit</dt>
                    <dd className="tabular-nums">
                      {b.metric === 'COST_USD' ? usd(b.hardLimit) : fmt(b.hardLimit)} {metricUnit(b.metric)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Remaining</dt>
                    <dd className="tabular-nums">
                      {b.metric === 'COST_USD' ? usd(b.remaining) : fmt(Math.round(b.remaining))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Soft limit</dt>
                    <dd className="tabular-nums">
                      {soft == null ? 'None' : b.metric === 'COST_USD' ? usd(soft) : fmt(soft)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-muted">{pct(b.utilization)} of hard limit</p>
              </Card>
            );
          })}
        </div>
      )}

      <Card title="Policy packs">
        <p className="mb-3 text-sm text-muted">
          Drop a portable pack onto this tenant. Creates budgets and policies; it does not replace existing ones.
        </p>
        {data.packs.length === 0 ? (
          <EmptyState title="No packs loaded" body="Built-in packs come from the backend process catalog." />
        ) : (
          <ul className="space-y-3">
            {data.packs.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-ink-strong">{p.name}</p>
                  <p className="text-xs text-muted">{p.description}</p>
                </div>
                <Button
                  variant="secondary"
                  className="shrink-0"
                  onClick={async () => {
                    try {
                      const r = await api.importPolicyPack(p.id);
                      setPackStatus(
                        `Imported ${r.packName}: ${r.budgetsCreated} budgets, ${r.policiesCreated} policies`
                      );
                      data.reload();
                    } catch (err) {
                      onError((err as Error).message);
                    }
                  }}
                >
                  Import
                </Button>
              </li>
            ))}
          </ul>
        )}
        {packStatus && <p className="mt-3 text-xs text-success-ink">{packStatus}</p>}
      </Card>
    </div>
  );
}
