import { useState } from 'react';
import type { ToolCallView } from '../../api';
import { cn } from '../../lib/cn';
import { Badge, usd } from '../primitives';

/** `{ level: "AGENT", hardLimit: 120000 }` -> `level=AGENT · hardLimit=120000` */
export function summarizeArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const text =
        typeof v === 'object' ? JSON.stringify(v) : typeof v === 'string' ? v : String(v);
      return `${k}=${text.length > 40 ? `${text.slice(0, 37)}…` : text}`;
    });
  return parts.length ? parts.join(' · ') : 'no arguments';
}

const STATUS_LABEL: Record<string, string> = {
  running: 'running',
  executed: 'done',
  pending_confirmation: 'needs confirmation',
  denied: 'declined',
  expired: 'confirmation expired',
  error: 'failed',
};

/**
 * One step the agent took: what it called, with what, what came back, and what
 * that step cost. The point is that an acting agent is auditable in the UI, not
 * just in the log.
 */
export function ToolCallCard({
  call,
  costUsd,
  tokens,
}: {
  call: ToolCallView;
  costUsd?: number;
  tokens?: number;
}) {
  const [open, setOpen] = useState(false);
  const failed = call.status === 'error';

  return (
    <div
      className={cn(
        'border rounded-lg text-sm',
        failed ? 'border-danger bg-danger-soft' : 'border-edge bg-surface-muted'
      )}
    >
      <div className="flex items-start gap-2 p-2.5">
        <span className="font-mono text-xs text-ink-strong shrink-0 pt-0.5">{call.tool}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge text={call.risk} />
          <Badge text={STATUS_LABEL[call.status] ?? call.status} tone={statusTone(call.status)} />
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-ink-faint shrink-0">
          {call.durationMs > 0 && <span>{call.durationMs}ms</span>}
          {tokens !== undefined && tokens > 0 && <span>{tokens} tok</span>}
          {costUsd !== undefined && costUsd > 0 && <span>{usd(costUsd)}</span>}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={cn(
              'underline underline-offset-2 hover:text-ink',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring rounded'
            )}
          >
            {open ? 'hide' : 'details'}
          </button>
        </div>
      </div>

      <p className="px-2.5 pb-2 text-xs text-ink-muted">{call.summary}</p>

      {open && (
        <dl className="border-t border-edge-subtle px-2.5 py-2 space-y-1.5 text-xs">
          <div>
            <dt className="text-ink-faint">arguments</dt>
            <dd className="font-mono text-ink break-words">{summarizeArgs(call.args)}</dd>
          </div>
          {call.error && (
            <div>
              <dt className="text-ink-faint">error</dt>
              <dd className="text-danger-ink break-words">{call.error}</dd>
            </div>
          )}
          {call.result !== undefined && (
            <div>
              <dt className="text-ink-faint">result</dt>
              <dd>
                <pre className="font-mono text-ink whitespace-pre-wrap break-words max-h-result overflow-auto">
                  {JSON.stringify(call.result, null, 2)}
                </pre>
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function statusTone(status: string) {
  if (status === 'executed') return 'ok' as const;
  if (status === 'pending_confirmation') return 'gate' as const;
  if (status === 'error') return 'danger' as const;
  if (status === 'running') return 'info' as const;
  return 'neutral' as const;
}
