import { useCallback, useEffect, useState } from 'react';
import {
  api,
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  type TotalSpend,
  type AgentSpend,
  type TaskSpend,
  type BudgetStatus,
  type PolicyEvent,
  type ExpensivePrompt,
  type LoopRow,
  type Recommendation,
  type SavingsLedger,
} from './api';
import { AssistantPanel } from './components/assistant/AssistantPanel';
import { Badge, Button, Card, Stat, Table, UtilBar, fmt, usd } from './components/primitives';
import { cn } from './lib/cn';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'assistant', label: 'Assistant' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [total, setTotal] = useState<TotalSpend | null>(null);
  const [agents, setAgents] = useState<AgentSpend[]>([]);
  const [tasks, setTasks] = useState<TaskSpend[]>([]);
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [warnings, setWarnings] = useState<PolicyEvent[]>([]);
  const [blocked, setBlocked] = useState<PolicyEvent[]>([]);
  const [expensive, setExpensive] = useState<ExpensivePrompt[]>([]);
  const [loops, setLoops] = useState<LoopRow[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [savings, setSavings] = useState<SavingsLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState(getApiKey());
  const [urlInput, setUrlInput] = useState(getBaseUrl());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [packs, setPacks] = useState<{ id: string; name: string; description: string }[]>([]);
  const [packStatus, setPackStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, a, ts, b, w, bl, e, l, r, sav, pk] = await Promise.all([
        api.total(),
        api.byAgent(),
        api.byTask(),
        api.activeBudgets(),
        api.warnings(),
        api.blocked(),
        api.expensive(),
        api.loops(),
        api.recommendations(),
        api.savingsLedger(),
        api.listPolicyPacks(),
      ]);
      setTotal(t);
      setAgents(a);
      setTasks(ts);
      setBudgets(b);
      setWarnings(w);
      setBlocked(bl);
      setExpensive(e);
      setLoops(l);
      setRecs(r);
      setSavings(sav);
      setPacks(pk);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    // Polling only matters for the numbers; pause it while the assistant tab is
    // open so a refresh cannot interrupt a streaming turn's scroll position.
    if (tab !== 'overview') return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load, tab]);

  const applySettings = () => {
    setApiKey(keyInput.trim());
    setBaseUrl(urlInput.trim());
    load();
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <header className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-strong">Token Budget Manager</h1>
          <p className="text-sm text-ink-muted">
            Control layer between your agents and LLM APIs
            {lastUpdated && ` · updated ${lastUpdated.toLocaleTimeString()}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="text-xs border border-edge-strong rounded px-2 py-1 w-40 bg-surface"
            placeholder="Base URL (blank = proxy)"
            aria-label="Backend base URL"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
          />
          <input
            className="text-xs border border-edge-strong rounded px-2 py-1 w-44 bg-surface"
            placeholder="API key"
            aria-label="API key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
          <Button onClick={applySettings}>Apply &amp; refresh</Button>
        </div>
      </header>

      <nav className="flex gap-1 mb-6 border-b border-edge" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={cn(
              'text-sm px-3 py-2 -mb-px border-b-2 font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring rounded-t',
              tab === t.id
                ? 'border-accent text-ink-strong'
                : 'border-transparent text-ink-muted hover:text-ink'
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-danger-soft text-danger-ink text-sm border border-danger">
          Cannot reach backend: {error}. Is the API running on :4000 and the key correct?
        </div>
      )}

      {tab === 'assistant' ? (
        <AssistantPanel onMutated={load} />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <Card title="Total spend">
              <Stat
                label="tokens"
                value={total ? fmt(total.totalTokens) : '—'}
                sub={total ? usd(total.costUsd) : undefined}
              />
            </Card>
            <Card title="Requests">
              <Stat label="LLM calls accounted" value={total ? fmt(total.requests) : '—'} />
            </Card>
            <Card title="Input tokens">
              <Stat label="prompt" value={total ? fmt(total.inputTokens) : '—'} />
            </Card>
            <Card title="Output tokens">
              <Stat label="completion" value={total ? fmt(total.outputTokens) : '—'} />
            </Card>
            <Card title="Cached / tool">
              <Stat
                label="cached + tool"
                value={total ? fmt(total.cachedTokens + total.toolTokens) : '—'}
              />
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Active budgets">
              <div className="space-y-3">
                {budgets.length === 0 && (
                  <p className="text-sm text-ink-faint">No budgets defined.</p>
                )}
                {budgets.map((b) => (
                  <div key={b.budgetId}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">
                        {b.name} <span className="text-ink-faint">({b.level})</span>
                      </span>
                      <span className="text-ink-muted">
                        {fmt(Math.round(b.used + b.reserved))} / {fmt(b.hardLimit)}{' '}
                        {b.metric === 'COST_USD' ? '$' : 'tok'}
                      </span>
                    </div>
                    <UtilBar v={b.utilization} label={`${b.name} utilization`} />
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Savings ledger (counterfactual ROI)" className="lg:col-span-2">
              {savings ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Stat
                    label="estimated saved"
                    value={usd(savings.totalSavedUsd)}
                    sub={`${fmt(savings.totalSavedTokens)} tokens avoided`}
                  />
                  <Stat
                    label="blocked requests"
                    value={String(savings.blockedRequests)}
                    sub="hard stops"
                  />
                  <Stat
                    label="optimized"
                    value={String(savings.optimizedRequests)}
                    sub="degrade/compress"
                  />
                  <div className="col-span-2 md:col-span-4">
                    {savings.byDecision.length === 0 ? (
                      <p className="text-sm text-ink-faint">
                        No policy-driven savings recorded yet — run the demo to populate.
                      </p>
                    ) : (
                      <Table
                        head={['Decision', 'Events', 'Saved $', 'Saved tokens']}
                        rows={savings.byDecision.map((d) => [
                          d.decision,
                          String(d.count),
                          usd(d.savedUsd),
                          fmt(d.savedTokens),
                        ])}
                      />
                    )}
                    <p className="text-xs text-ink-faint mt-2">{savings.note}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ink-faint">Loading…</p>
              )}
            </Card>

            <Card title="Optimization recommendations">
              <div className="space-y-2">
                {recs.length === 0 && (
                  <p className="text-sm text-ink-faint">No recommendations right now.</p>
                )}
                {recs.map((r, i) => (
                  <div
                    key={i}
                    className={cn(
                      'text-sm p-2 rounded',
                      r.severity === 'warn'
                        ? 'bg-warn-soft text-warn-ink'
                        : 'bg-surface-muted text-ink'
                    )}
                  >
                    <span className="font-medium">{r.type}:</span> {r.message}
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Spend by agent">
              <Table
                head={['Agent', 'Tokens', 'Cost', 'Reqs']}
                rows={agents.map((a) => [
                  a.agentName,
                  fmt(a.totalTokens),
                  usd(a.costUsd),
                  String(a.requests),
                ])}
              />
            </Card>

            <Card title="Chargeback &amp; policy packs">
              <p className="text-xs text-ink-muted mb-2">
                Export cost by dimension for finance, or drop a portable pack onto this tenant.
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {(['agent', 'task', 'project', 'user'] as const).map((g) => (
                  <Button
                    key={g}
                    onClick={() =>
                      api.downloadChargebackCsv(g).catch((err) => setError((err as Error).message))
                    }
                  >
                    CSV · {g}
                  </Button>
                ))}
              </div>
              <div className="space-y-2">
                {packs.length === 0 && (
                  <p className="text-sm text-ink-faint">No built-in packs loaded.</p>
                )}
                {packs.map((p) => (
                  <div key={p.id} className="flex items-start justify-between gap-2 text-sm">
                    <div>
                      <div className="font-medium text-ink">{p.name}</div>
                      <div className="text-xs text-ink-faint">{p.description}</div>
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
                          load();
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                    >
                      Import
                    </Button>
                  </div>
                ))}
                {packStatus && <p className="text-xs text-ok-ink">{packStatus}</p>}
              </div>
            </Card>

            <Card title="Spend by task">
              <Table
                head={['Task', 'Tokens', 'Cost', 'Reqs']}
                rows={tasks.map((t) => [
                  t.taskName,
                  fmt(t.totalTokens),
                  usd(t.costUsd),
                  String(t.requests),
                ])}
              />
            </Card>

            <Card title="Most expensive prompts">
              <Table
                head={['Model', 'Tokens', 'Cost']}
                rows={expensive.map((e) => [e.model, fmt(e.totalTokens), usd(e.costUsd)])}
              />
            </Card>

            <Card title="Inefficient agent loops">
              {loops.length === 0 ? (
                <p className="text-sm text-ink-faint">No repeated-request loops detected.</p>
              ) : (
                <Table
                  head={['Session', 'Repeats']}
                  rows={loops.map((l) => [`${l.sessionId?.slice(0, 10)}…`, String(l.repeats)])}
                />
              )}
            </Card>

            <Card title="Warnings">
              <EventList events={warnings} />
            </Card>

            <Card title="Blocked requests">
              <EventList events={blocked} />
            </Card>
          </div>
        </>
      )}

      <footer className="text-xs text-ink-faint mt-8 text-center">
        {tab === 'overview' ? 'Polling every 5s · ' : ''}demo data via <code>npm run demo</code> in{' '}
        <code>backend/</code>
      </footer>
    </div>
  );
}

function EventList({ events }: { events: PolicyEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-ink-faint">Nothing recorded.</p>;
  return (
    <div className="space-y-2 max-h-chat overflow-auto">
      {events.map((e) => (
        <div key={e.id} className="flex items-start gap-2 text-sm">
          <Badge text={e.decision} />
          <div className="flex-1">
            <div className="text-ink">{e.reason}</div>
            <div className="text-xs text-ink-faint">
              {new Date(e.createdAt).toLocaleTimeString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
