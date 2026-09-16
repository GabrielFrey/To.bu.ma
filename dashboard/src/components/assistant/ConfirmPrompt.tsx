import { useEffect, useRef, useState } from 'react';
import type { ToolCallView } from '../../api';
import { Badge, Button } from '../primitives';
import { summarizeArgs } from './ToolCallCard';

function secondsLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

/**
 * The confirmation gate. The operator sees the exact call and the reason it was
 * held back before anything happens, and the countdown is real: the token is
 * signed with an expiry, so an abandoned prompt cannot be approved later.
 */
export function ConfirmPrompt({
  call,
  busy,
  onDecide,
}: {
  call: ToolCallView;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const confirmRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(() => secondsLeft(call.confirm?.expiresAt ?? ''));

  // Pull focus to the prompt: the turn has stopped and cannot continue until the
  // operator answers, so keyboard users should land here.
  useEffect(() => {
    confirmRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  useEffect(() => {
    if (!call.confirm) return;
    const id = setInterval(() => setLeft(secondsLeft(call.confirm!.expiresAt)), 1000);
    return () => clearInterval(id);
  }, [call.confirm]);

  const expired = left === 0;

  return (
    <div
      ref={confirmRef}
      role="group"
      aria-label={`Confirm ${call.tool}`}
      className="border-2 border-gate rounded-lg bg-gate-soft p-3 space-y-2"
    >
      <div className="flex items-center gap-2">
        <Badge text="confirmation required" tone="gate" icon="!" />
        <span className="font-mono text-xs text-ink-strong">{call.tool}</span>
      </div>
      <p className="text-sm text-ink-body">{call.confirm?.reason ?? call.summary}</p>
      <p className="font-mono text-xs text-ink-muted break-words">{summarizeArgs(call.args)}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="danger" disabled={busy || expired} onClick={() => onDecide(true)}>
          Run it
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => onDecide(false)}>
          Cancel
        </Button>
        <span className="text-xs text-ink-muted" aria-live="polite">
          {expired ? 'Confirmation expired — ask again.' : `Expires in ${left}s`}
        </span>
      </div>
    </div>
  );
}
