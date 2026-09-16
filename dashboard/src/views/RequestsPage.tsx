import type { PolicyEvent } from '../api';
import type { DashboardData } from '../hooks/useDashboardData';
import type { PeriodId } from '../lib/period';
import { periodLabel } from '../lib/period';
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Skeleton,
  Table,
  formatWhen,
  usd,
} from '../components/primitives';

function EventList({ events, empty }: { events: PolicyEvent[]; empty: string }) {
  if (events.length === 0) return <EmptyState title="Nothing here" body={empty} />;
  return (
    <ul className="max-h-80 space-y-2 overflow-auto">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-2 text-sm">
          <Badge text={e.decision} />
          <div className="min-w-0 flex-1">
            <p className="text-ink">{e.reason}</p>
            <p className="text-xs text-muted">{formatWhen(e.createdAt)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RequestsPage({ data, period }: { data: DashboardData; period: PeriodId }) {
  if (data.loading) {
    return (
      <div>
        <PageHeader title="Requests" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Requests"
        description={`Blocked calls, warnings, and recent LLM requests for ${periodLabel(period).toLowerCase()}.`}
      />

      {data.error && (
        <div className="mb-4">
          <ErrorBanner message={data.error} onRetry={data.reload} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Blocked">
          <EventList
            events={data.blocked}
            empty="No hard stops or approval gates in this period."
          />
        </Card>
        <Card title="Warnings">
          <EventList
            events={data.warnings}
            empty="No warn/degrade/compress events in this period."
          />
        </Card>
        <Card title="Recent LLM requests" className="lg:col-span-2">
          {data.recent.length === 0 ? (
            <EmptyState
              title="No requests yet"
              body="Completed, blocked, and reserved calls from the gateway will list here."
            />
          ) : (
            <Table
              head={['When', 'Model', 'Status', 'Decision', 'Est. cost']}
              rows={data.recent.map((r) => [
                formatWhen(r.createdAt),
                r.model,
                r.status,
                r.decision ?? '—',
                usd(r.estimatedCostUsd),
              ])}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
