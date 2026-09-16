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

export function metricUnit(metric: string): string {
  return metric === 'COST_USD' ? 'USD' : 'tok';
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-strong">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </header>
  );
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
    <section className={cn('rounded-xl border border-border bg-surface p-4 shadow-sm', className)}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-strong">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const valueClass =
    tone === 'danger'
      ? 'text-danger-ink'
      : tone === 'warning'
        ? 'text-warning-ink'
        : tone === 'success'
          ? 'text-success-ink'
          : 'text-ink-strong';
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold tracking-tight tabular-nums', valueClass)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xl font-semibold tracking-tight tabular-nums text-ink-strong">{value}</div>
      <div className="text-xs text-muted">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-faint">{sub}</div>}
    </div>
  );
}

export function UtilBar({ v, label }: { v: number; label?: string }) {
  const value = Math.min(100, Math.round(v * 100));
  const tone = v >= 1 ? 'bg-danger' : v >= 0.8 ? 'bg-warning' : 'bg-success';
  return (
    <div
      className="h-2 w-full overflow-hidden rounded bg-surface-inset"
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

/** Dual bar: hard fill + a soft-limit marker. */
export function BudgetBar({
  utilization,
  softRatio,
  name,
}: {
  utilization: number;
  softRatio?: number | null;
  name: string;
}) {
  const value = Math.min(100, Math.round(utilization * 100));
  const tone = utilization >= 1 ? 'bg-danger' : utilization >= 0.8 ? 'bg-warning' : 'bg-success';
  const marker = softRatio != null ? Math.min(100, Math.round(softRatio * 100)) : null;
  return (
    <div
      className="relative h-2.5 w-full overflow-hidden rounded bg-surface-inset"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${name} utilization`}
    >
      <div className={cn('h-2.5', tone)} style={{ width: `${value}%` }} />
      {marker != null && (
        <span
          className="absolute top-0 h-2.5 w-0.5 bg-ink-strong/70"
          style={{ left: `${marker}%` }}
          title={`Soft limit at ${marker}%`}
        />
      )}
    </div>
  );
}

export function SparkBar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-inset" aria-hidden="true">
      <div className="h-1.5 rounded-full bg-accent" style={{ width: `${width}%` }} />
    </div>
  );
}

const TONE_CLASS: Record<string, string> = {
  neutral: 'text-ink bg-surface-inset',
  info: 'text-info-ink bg-info-soft',
  ok: 'text-success-ink bg-success-soft',
  warn: 'text-warning-ink bg-warning-soft',
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
  completed: 'ok',
  blocked: 'danger',
  failed: 'danger',
  reserved: 'info',
};

export function toneForDecision(text: string): Tone {
  return DECISION_TONE[text] ?? 'neutral';
}

export function Badge({ text, tone, icon }: { text: string; tone?: Tone; icon?: string }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        TONE_CLASS[tone ?? toneForDecision(text)]
      )}
    >
      {icon && <span aria-hidden="true">{icon} </span>}
      {text}
    </span>
  );
}

export function Table({
  head,
  rows,
  empty = 'No data yet.',
}: {
  head: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-muted">
            {head.map((h) => (
              <th key={h} scope="col" className="sticky top-0 bg-surface py-1.5 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border-subtle last:border-0">
              {r.map((c, j) => (
                <td key={j} className="py-1.5 pr-3 text-ink">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  const variants = {
    primary: 'bg-accent text-ink-inverse hover:bg-accent-hover',
    secondary: 'border border-border-strong text-ink hover:bg-surface-muted',
    danger: 'bg-danger text-ink-inverse hover:bg-danger-ink',
    ghost: 'text-ink hover:bg-surface-muted',
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { id: T; label: string }[];
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex rounded-lg border border-border bg-surface-muted p-0.5"
    >
      {options.map((opt) => {
        const selected = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(opt.id)}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring',
              selected ? 'bg-surface text-ink-strong shadow-sm' : 'text-muted hover:text-ink'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-inset motion-reduce:animate-none', className)}
      aria-hidden="true"
    />
  );
}

export function SkeletonBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={i === 0 ? 'h-4 w-2/3' : 'h-3 w-full'} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-2 py-8 text-center">
      <p className="text-sm font-medium text-ink-strong">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm text-danger-ink"
    >
      <p>{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
