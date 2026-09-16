import { useState } from 'react';
import { api, type SimulationResult } from '../api';
import type { DashboardData } from '../hooks/useDashboardData';
import type { PeriodId } from '../lib/period';
import { periodLookbackHours } from '../lib/period';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Skeleton,
  Table,
  usd,
} from '../components/primitives';

export function PoliciesPage({
  data,
  period,
  onError,
}: {
  data: DashboardData;
  period: PeriodId;
  onError: (message: string) => void;
}) {
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const budgetName = new Map(data.budgetRecords.map((b) => [b.id, b.name]));
  const active = data.policies.filter((p) => p.active);

  if (data.loading) {
    return (
      <div>
        <PageHeader title="Policies" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const simulate = async () => {
    setBusy(true);
    try {
      const result = await api.simulatePolicies({
        hypotheticalPolicies: active.map((p) => ({
          name: p.name,
          condition: p.condition,
          action: p.action,
          priority: p.priority,
        })),
        lookbackHours: periodLookbackHours(period),
      });
      setSim(result);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Policies"
        description="Active rules on this tenant. Simulate against recent traffic without persisting anything."
        actions={
          <Button onClick={() => void simulate()} disabled={busy || active.length === 0}>
            {busy ? 'Simulating…' : 'Simulate on this period'}
          </Button>
        }
      />

      {data.error && (
        <div className="mb-4">
          <ErrorBanner message={data.error} onRetry={data.reload} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Active policies">
          {active.length === 0 ? (
            <EmptyState
              title="No active policies"
              body="Import a pack on Budgets, or ask the assistant to add a rule."
            />
          ) : (
            <ul className="space-y-3">
              {active.map((p) => (
                <li key={p.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-ink-strong">{p.name}</p>
                    <Badge text={p.action.toLowerCase().replace(/_/g, '-')} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {p.condition} · {budgetName.get(p.budgetId) ?? 'budget'} · priority {p.priority}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Last simulated savings">
          {!sim ? (
            <EmptyState
              title="Not simulated yet"
              body="Run a dry-run of the current policies against traffic in the selected period."
              action={
                <Button variant="secondary" onClick={() => void simulate()} disabled={busy || active.length === 0}>
                  Simulate
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <p>
                  <span className="block text-xs text-muted">Sample</span>
                  {sim.sampleSize} requests
                </p>
                <p>
                  <span className="block text-xs text-muted">Projected savings</span>
                  <span className="font-semibold tabular-nums">{usd(sim.projectedSavingsUsd)}</span>
                </p>
                <p>
                  <span className="block text-xs text-muted">Would block</span>
                  {sim.wouldBlock}
                </p>
                <p>
                  <span className="block text-xs text-muted">Would degrade</span>
                  {sim.wouldDegrade}
                </p>
              </div>
              {sim.examples.length > 0 && (
                <Table
                  head={['Model', 'Actual', 'Simulated']}
                  rows={sim.examples.map((e) => [
                    e.model,
                    e.actualDecision ?? '—',
                    e.simulatedDecision,
                  ])}
                />
              )}
              <p className="text-xs text-muted">{sim.note}</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
