import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export function fmt(n: number): string {
  return n.toLocaleString();
}

export function usd(n: number): string {
  return `$${n.toFixed(n !== 0 && Math.abs(n) < 0.01 ? 6 : 4)}`;
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(n < 0.1 ? 2 : 1)}%`;
}

export function Card({
  title,
  children,
  className,
  action,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={cn('bg-surface rounded-xl shadow-sm border border-edge p-4', className)}>
      <header className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-2xl font-bold text-ink-body">{value}</div>
      <div className="text-xs text-ink-muted">{label}</div>
      {sub && <div className="text-xs text-ink-faint mt-0.5">{sub}</div>}
    </div>
  );
}

export function UtilBar({ v, label }: { v: number; label?: string }) {
  const value = Math.min(100, Math.round(v * 100));
  const tone = v >= 1 ? 'bg-danger' : v >= 0.8 ? 'bg-warn' : 'bg-ok';
  return (
    <div
      className="w-full bg-surface-inset rounded h-2 overflow-hidden"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'utilization'}
    >
      <div className={cn('h-2', tone)} style={{ width: `${value}%` }} />
    </div>
  );
}

/**
 * Decision/status pill. Severity is carried by the label text as well as the
 * colour, so it survives a greyscale print or a colour-vision deficiency.
 */
const TONE_CLASS: Record<string, string> = {
  neutral: 'text-ink bg-surface-inset',
  info: 'text-info-ink bg-info-soft',
  ok: 'text-ok-ink bg-ok-soft',
  warn: 'text-warn-ink bg-warn-soft',
  danger: 'text-danger-ink bg-danger-soft',
  gate: 'text-gate-ink bg-gate-soft',
};

export type Tone = keyof typeof TONE_CLASS;

const DECISION_TONE: Record<string, Tone> = {
  allow: 'ok',
  warn: 'warn',
  degrade: 'warn',
  compress: 'info',
  summarize: 'info',
  truncate: 'warn',
  'require-approval': 'gate',
  'stop-agent': 'danger',
  'retry-limit': 'danger',
  'tool-limit': 'danger',
  read: 'info',
  write: 'warn',
  destructive: 'danger',
  executed: 'ok',
  pending_confirmation: 'gate',
  denied: 'danger',
  error: 'danger',
  expired: 'neutral',
};

export function toneForDecision(text: string): Tone {
  return DECISION_TONE[text] ?? 'neutral';
}

export function Badge({ text, tone, icon }: { text: string; tone?: Tone; icon?: string }) {
  return (
    <span
      className={cn(
        'text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap',
        TONE_CLASS[tone ?? toneForDecision(text)]
      )}
    >
      {icon && <span aria-hidden="true">{icon} </span>}
      {text}
    </span>
  );
}

export function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  if (rows.length === 0) return <p className="text-sm text-ink-faint">No data yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-ink-faint border-b border-edge-subtle">
          {head.map((h) => (
            <th key={h} scope="col" className="py-1 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-edge-subtle last:border-0">
            {r.map((c, j) => (
              <td key={j} className="py-1.5 text-ink">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  className,
  disabled,
  type = 'button',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  const variants = {
    primary: 'bg-accent text-ink-inverse hover:bg-accent-hover',
    secondary: 'border border-edge-strong text-ink hover:bg-surface-muted',
    danger: 'bg-danger text-ink-inverse hover:bg-danger-ink',
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'text-xs rounded px-3 py-1.5 font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
}
