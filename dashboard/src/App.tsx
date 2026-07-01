import { useCallback, useEffect, useState } from 'react';
import {
  api, getApiKey, setApiKey, getBaseUrl, setBaseUrl,
  type TotalSpend, type AgentSpend, type TaskSpend, type BudgetStatus,
  type PolicyEvent, type ExpensivePrompt, type LoopRow, type Recommendation,
} from './api';

function fmt(n: number): string {
  return n.toLocaleString();
}
function usd(n: number): string {
  return `$${n.toFixed(n < 0.01 ? 6 : 4)}`;
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 p-4 ${className}`}>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function UtilBar({ v }: { v: number }) {
  const pct = Math.min(100, Math.round(v * 100));
  const color = v >= 1 ? 'bg-red-500' : v >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="w-full bg-slate-100 rounded h-2 overflow-hidden">
      <div className={`h-2 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const decisionColor: Record<string, string> = {
  warn: 'text-amber-600 bg-amber-50',
  degrade: 'text-amber-700 bg-amber-50',
  compress: 'text-sky-700 bg-sky-50',
  summarize: 'text-sky-700 bg-sky-50',
  truncate: 'text-orange-700 bg-orange-50',
  'require-approval': 'text-purple-700 bg-purple-50',
  'stop-agent': 'text-red-700 bg-red-50',
  'retry-limit': 'text-red-700 bg-red-50',
  'tool-limit': 'text-red-700 bg-red-50',
};

function Badge({ text }: { text: string }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${decisionColor[text] ?? 'text-slate-600 bg-slate-100'}`}>{text}</span>;
}

export default function App() {
  const [total, setTotal] = useState<TotalSpend | null>(null);
  const [agents, setAgents] = useState<AgentSpend[]>([]);
  const [tasks, setTasks] = useState<TaskSpend[]>([]);
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [warnings, setWarnings] = useState<PolicyEvent[]>([]);
  const [blocked, setBlocked] = useState<PolicyEvent[]>([]);
  const [expensive, setExpensive] = useState<ExpensivePrompt[]>([]);
  const [loops, setLoops] = useState<LoopRow[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState(getApiKey());
  const [urlInput, setUrlInput] = useState(getBaseUrl());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, a, ts, b, w, bl, e, l, r] = await Promise.all([
        api.total(), api.byAgent(), api.byTask(), api.activeBudgets(),
        api.warnings(), api.blocked(), api.expensive(), api.loops(), api.recommendations(),
      ]);
      setTotal(t); setAgents(a); setTasks(ts); setBudgets(b);
      setWarnings(w); setBlocked(bl); setExpensive(e); setLoops(l); setRecs(r);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000); // live-ish polling
    return () => clearInterval(id);
  }, [load]);

  const applySettings = () => {
    setApiKey(keyInput.trim());
    setBaseUrl(urlInput.trim());
    load();
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Token Budget Manager</h1>
          <p className="text-sm text-slate-500">
            Control layer between your agents and LLM APIs
            {lastUpdated && ` · updated ${lastUpdated.toLocaleTimeString()}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="text-xs border border-slate-300 rounded px-2 py-1 w-40"
            placeholder="Base URL (blank = proxy)"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
          />
          <input
            className="text-xs border border-slate-300 rounded px-2 py-1 w-44"
            placeholder="API key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
          <button onClick={applySettings} className="text-xs bg-slate-800 text-white rounded px-3 py-1.5 hover:bg-slate-700">
            Apply & refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
          Cannot reach backend: {error}. Is the API running on :4000 and the key correct?
        </div>
      )}

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card title="Total spend"><Stat label="tokens" value={total ? fmt(total.totalTokens) : '—'} sub={total ? usd(total.costUsd) : undefined} /></Card>
        <Card title="Requests"><Stat label="LLM calls accounted" value={total ? fmt(total.requests) : '—'} /></Card>
        <Card title="Input tokens"><Stat label="prompt" value={total ? fmt(total.inputTokens) : '—'} /></Card>
        <Card title="Output tokens"><Stat label="completion" value={total ? fmt(total.outputTokens) : '—'} /></Card>
        <Card title="Cached / tool"><Stat label="cached + tool" value={total ? fmt(total.cachedTokens + total.toolTokens) : '—'} /></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Active budgets */}
        <Card title="Active budgets">
          <div className="space-y-3">
            {budgets.length === 0 && <p className="text-sm text-slate-400">No budgets defined.</p>}
            {budgets.map((b) => (
              <div key={b.budgetId}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{b.name} <span className="text-slate-400">({b.level})</span></span>
                  <span className="text-slate-500">
                    {fmt(Math.round(b.used + b.reserved))} / {fmt(b.hardLimit)} {b.metric === 'COST_USD' ? '$' : 'tok'}
                  </span>
                </div>
                <UtilBar v={b.utilization} />
              </div>
            ))}
          </div>
        </Card>

        {/* Recommendations */}
        <Card title="Optimization recommendations">
          <div className="space-y-2">
            {recs.length === 0 && <p className="text-sm text-slate-400">No recommendations right now.</p>}
            {recs.map((r, i) => (
              <div key={i} className={`text-sm p-2 rounded ${r.severity === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600'}`}>
                <span className="font-medium">{r.type}:</span> {r.message}
              </div>
            ))}
          </div>
        </Card>

        {/* Spend by agent */}
        <Card title="Spend by agent">
          <Table
            rows={agents.map((a) => [a.agentName, fmt(a.totalTokens), usd(a.costUsd), String(a.requests)])}
            head={['Agent', 'Tokens', 'Cost', 'Reqs']}
          />
        </Card>

        {/* Spend by task */}
        <Card title="Spend by task">
          <Table
            rows={tasks.map((t) => [t.taskName, fmt(t.totalTokens), usd(t.costUsd), String(t.requests)])}
            head={['Task', 'Tokens', 'Cost', 'Reqs']}
          />
        </Card>

        {/* Most expensive prompts */}
        <Card title="Most expensive prompts">
          <Table
            rows={expensive.map((e) => [e.model, fmt(e.totalTokens), usd(e.costUsd)])}
            head={['Model', 'Tokens', 'Cost']}
          />
        </Card>

        {/* Inefficient loops */}
        <Card title="Inefficient agent loops">
          {loops.length === 0 ? (
            <p className="text-sm text-slate-400">No repeated-request loops detected.</p>
          ) : (
            <Table
              rows={loops.map((l) => [l.sessionId?.slice(0, 10) + '…', String(l.repeats)])}
              head={['Session', 'Repeats']}
            />
          )}
        </Card>

        {/* Warnings */}
        <Card title="Warnings">
          <EventList events={warnings} />
        </Card>

        {/* Blocked requests */}
        <Card title="Blocked requests">
          <EventList events={blocked} />
        </Card>
      </div>

      <footer className="text-xs text-slate-400 mt-8 text-center">
        Polling every 5s · demo data via <code>npm run demo</code> in <code>backend/</code>
      </footer>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-400">No data yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-slate-400 border-b border-slate-100">
          {head.map((h) => <th key={h} className="py-1 font-medium">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-slate-50 last:border-0">
            {r.map((c, j) => <td key={j} className="py-1.5 text-slate-700">{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EventList({ events }: { events: PolicyEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-slate-400">Nothing recorded.</p>;
  return (
    <div className="space-y-2 max-h-64 overflow-auto">
      {events.map((e) => (
        <div key={e.id} className="flex items-start gap-2 text-sm">
          <Badge text={e.decision} />
          <div className="flex-1">
            <div className="text-slate-700">{e.reason}</div>
            <div className="text-xs text-slate-400">{new Date(e.createdAt).toLocaleTimeString()}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
