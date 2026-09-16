import { useEffect, useMemo, useRef, useState } from 'react';
import { NAV_ITEMS, type ViewId } from '../../lib/nav';
import { cn } from '../../lib/cn';
import type { DashboardData } from '../../hooks/useDashboardData';

interface Hit {
  id: string;
  label: string;
  hint: string;
  view: ViewId;
}

export function CommandSearch({
  open,
  onClose,
  onNavigate,
  data,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: ViewId) => void;
  data: DashboardData;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    const items: Hit[] = NAV_ITEMS.map((n) => ({
      id: `nav-${n.id}`,
      label: n.label,
      hint: n.hint,
      view: n.id,
    }));
    for (const a of data.agents) {
      items.push({
        id: `agent-${a.agentId ?? a.agentName}`,
        label: a.agentName,
        hint: 'Agent spend',
        view: 'spend',
      });
    }
    for (const r of data.recs) {
      items.push({ id: `rec-${r.type}`, label: r.message, hint: r.type, view: 'overview' });
    }
    for (const p of data.policies) {
      items.push({
        id: `pol-${p.id}`,
        label: p.name,
        hint: `${p.action} · ${p.condition}`,
        view: 'policies',
      });
    }
    if (!needle) return items.slice(0, 8);
    return items.filter(
      (h) =>
        h.label.toLowerCase().includes(needle) || h.hint.toLowerCase().includes(needle)
    ).slice(0, 12);
  }, [q, data.agents, data.recs, data.policies]);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  if (!open) return null;

  const go = (hit: Hit) => {
    onNavigate(hit.view);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink-strong/30"
        aria-label="Dismiss search"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(hits.length - 1, i + 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            }
            if (e.key === 'Enter' && hits[active]) go(hits[active]);
          }}
          placeholder="Search pages, agents, policies…"
          className="w-full border-b border-border bg-surface px-4 py-3 text-sm text-ink outline-none"
          aria-label="Search"
        />
        <ul className="max-h-80 overflow-auto py-1" role="listbox">
          {hits.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted">No matches.</li>
          )}
          {hits.map((hit, i) => (
            <li key={hit.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onClick={() => go(hit)}
                className={cn(
                  'flex w-full flex-col items-start px-4 py-2 text-left text-sm',
                  i === active ? 'bg-accent-soft' : 'hover:bg-surface-muted'
                )}
              >
                <span className="font-medium text-ink-strong">{hit.label}</span>
                <span className="text-xs text-muted">{hit.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-4 py-2 text-xs text-muted">
          ↑↓ to move · Enter to open · Esc to close
        </p>
      </div>
    </div>
  );
}
