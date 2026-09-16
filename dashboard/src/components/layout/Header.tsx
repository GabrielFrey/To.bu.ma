import { PERIODS, type PeriodId } from '../../lib/period';
import { cn } from '../../lib/cn';
import { Button } from '../primitives';

export function Header({
  period,
  onPeriod,
  tenantLabel,
  envLabel,
  lastUpdated,
  onMenu,
  onSearch,
  onAssistant,
  assistantOpen,
}: {
  period: PeriodId;
  onPeriod: (id: PeriodId) => void;
  tenantLabel: string;
  envLabel: string;
  lastUpdated: Date | null;
  onMenu: () => void;
  onSearch: () => void;
  onAssistant: () => void;
  assistantOpen: boolean;
}) {
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
      <button
        type="button"
        className="rounded-md border border-border-strong px-2 py-1 text-xs lg:hidden"
        onClick={onMenu}
        aria-label="Open navigation"
      >
        Menu
      </button>

      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-ink-strong">{tenantLabel}</p>
        <p className="text-xs text-muted">
          {envLabel}
          {lastUpdated && ` · updated ${lastUpdated.toLocaleTimeString()}`}
        </p>
      </div>

      <div
        role="group"
        aria-label="Time period"
        className="inline-flex rounded-lg border border-border bg-surface-muted p-0.5"
      >
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPeriod(p.id)}
            aria-pressed={period === p.id}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring',
              period === p.id ? 'bg-surface text-ink-strong shadow-sm' : 'text-muted hover:text-ink'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onSearch}
          className={cn(
            'hidden items-center gap-2 rounded-md border border-border-strong px-2.5 py-1.5 text-xs text-muted sm:flex',
            'hover:bg-surface-muted hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring'
          )}
        >
          Search
          <kbd className="rounded border border-border bg-surface-muted px-1 font-sans text-[10px]">
            ⌘K
          </kbd>
        </button>
        <Button
          variant={assistantOpen ? 'primary' : 'secondary'}
          onClick={onAssistant}
          title="Open assistant (chat and voice)"
        >
          <span aria-hidden="true">🎙</span> Assistant
        </Button>
      </div>
    </header>
  );
}
