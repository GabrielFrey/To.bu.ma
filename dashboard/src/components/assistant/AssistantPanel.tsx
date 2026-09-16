import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  streamAssistantChat,
  type AssistantSpend,
  type AssistantTools,
  type ChatRequest,
  type StreamEvent,
  type ToolCallView,
} from '../../api';
import { useVoice } from '../../hooks/useVoice';
import { cn } from '../../lib/cn';
import { Badge, Button, Card, Stat, UtilBar, fmt, pct, usd } from '../primitives';
import { ConfirmPrompt } from './ConfirmPrompt';
import { ToolCallCard } from './ToolCallCard';
import { VoiceControls } from './VoiceControls';

type Item =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; call: ToolCallView; tokens?: number; costUsd?: number }
  | { kind: 'confirm'; id: string; call: ToolCallView; decided?: 'approved' | 'cancelled' }
  | { kind: 'notice'; id: string; text: string; tone: 'info' | 'warn' | 'danger' };

const SUGGESTIONS = [
  'How much have we spent in total?',
  'Which agent is burning the most tokens?',
  'Show me blocked requests and why they were blocked',
  'Create a budget called "Q3 cap" for 500k tokens',
  'Forecast a 40-step run at 3000 tokens per step',
  'What would happen if I lowered the org budget by 30%?',
];

let seq = 0;
const nextId = () => `local-${(seq += 1)}`;

/**
 * The assistant surface: ask in text or by voice, watch the agent act, and
 * approve anything destructive before it happens. Its own spend is shown beside
 * the conversation, because an agent that cannot be metered should not be
 * trusted with a budget tool.
 */
export function AssistantPanel({ onMutated }: { onMutated?: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [tools, setTools] = useState<AssistantTools | null>(null);
  const [spend, setSpend] = useState<AssistantSpend | null>(null);
  const [turnCost, setTurnCost] = useState<{ tokens: number; usd: number } | null>(null);
  const [status, setStatus] = useState('');

  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);
  const conversationRef = useRef<string | undefined>(undefined);
  conversationRef.current = conversationId;

  const push = useCallback((item: Item) => setItems((prev) => [...prev, item]), []);

  const refreshSpend = useCallback(() => {
    api
      .assistantSpend()
      .then(setSpend)
      .catch(() => {
        /* the panel is still usable without the dogfooding widget */
      });
  }, []);

  useEffect(() => {
    api.assistantTools().then(setTools).catch(() => setTools(null));
    refreshSpend();
  }, [refreshSpend]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [items]);

  const send = useCallback(
    async (request: ChatRequest, echo?: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setTurnCost(null);
      setStatus('Thinking…');
      if (echo) push({ kind: 'user', id: nextId(), text: echo });

      // Tool calls are attributed to the LLM step that decided on them: the
      // runner emits `usage` for a step before the `tool_call`s it produced.
      let stepUsage: { tokens: number; costUsd: number } | null = null;
      let answered = false;
      let spoken = '';

      const handle = (event: StreamEvent) => {
        switch (event.type) {
          case 'conversation':
            setConversationId(event.conversationId);
            break;
          case 'usage': {
            const step = {
              tokens: event.step.inputTokens + event.step.outputTokens,
              costUsd: event.step.costUsd,
            };
            stepUsage = step;
            setTurnCost((prev) => ({
              tokens: (prev?.tokens ?? 0) + step.tokens,
              usd: (prev?.usd ?? 0) + step.costUsd,
            }));
            break;
          }
          case 'tool_call':
            setStatus(`Running ${event.call.tool}…`);
            push({
              kind: 'tool',
              id: event.call.id,
              call: event.call,
              tokens: stepUsage?.tokens,
              costUsd: stepUsage?.costUsd,
            });
            break;
          case 'tool_result':
            setItems((prev) =>
              prev.map((it) =>
                it.kind === 'tool' && it.id === event.call.id ? { ...it, call: event.call } : it
              )
            );
            break;
          case 'pending_confirmation':
            // The gated call was already shown as a tool card; replace it with
            // the prompt so there is exactly one thing to respond to.
            setItems((prev) => [
              ...prev.filter((it) => it.id !== event.call.id),
              { kind: 'confirm', id: event.call.id, call: event.call },
            ]);
            setStatus('Waiting for your confirmation');
            break;
          case 'delta':
            spoken = event.text;
            answered = true;
            push({ kind: 'assistant', id: nextId(), text: event.text });
            break;
          case 'blocked':
            push({
              kind: 'notice',
              id: nextId(),
              tone: 'danger',
              text: `Blocked by the assistant's own budget (${event.decision}): ${event.reason}`,
            });
            break;
          case 'done':
            if (!answered && event.response.pendingConfirmations.length === 0) {
              spoken = event.response.reply;
              push({ kind: 'assistant', id: nextId(), text: event.response.reply });
            }
            break;
          case 'error':
            push({ kind: 'notice', id: nextId(), tone: 'danger', text: event.error });
            break;
        }
      };

      try {
        await streamAssistantChat(request, handle);
      } catch (err) {
        push({
          kind: 'notice',
          id: nextId(),
          tone: 'danger',
          text: `${(err as Error).message}. Is the backend running and the API key set?`,
        });
      } finally {
        busyRef.current = false;
        setBusy(false);
        setStatus('');
        refreshSpend();
        onMutated?.();
        if (spoken && voiceRef.current?.speakReplies) voiceRef.current.speak(spoken);
      }
    },
    [onMutated, push, refreshSpend]
  );

  const submitText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busyRef.current) return;
      setInput('');
      void send({ conversationId: conversationRef.current, message: trimmed }, trimmed);
    },
    [send]
  );

  // Hands-free dictation submits on its own; the hook has no idea what a turn is.
  const voice = useVoice({ onFinalTranscript: (text) => submitText(text) });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const decide = useCallback(
    (call: ToolCallView, approve: boolean) => {
      if (!call.confirm) return;
      setItems((prev) =>
        prev.map((it) =>
          it.id === call.id && it.kind === 'confirm'
            ? { ...it, decided: approve ? 'approved' : 'cancelled' }
            : it
        )
      );
      void send({
        conversationId: conversationRef.current,
        confirmations: [{ toolCallId: call.id, confirmToken: call.confirm.confirmToken, approve }],
      });
    },
    [send]
  );

  const reset = useCallback(() => {
    setItems([]);
    setConversationId(undefined);
    setTurnCost(null);
    voiceRef.current.cancelSpeech();
    inputRef.current?.focus();
  }, []);

  const gated = useMemo(
    () => [...(tools?.alwaysConfirm ?? []), ...(tools?.conditionallyConfirm ?? [])],
    [tools]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card
        title="Assistant"
        className="lg:col-span-2 flex flex-col"
        action={
          <div className="flex items-center gap-2">
            {turnCost && (
              <span className="text-xs text-ink-faint">
                this turn: {fmt(turnCost.tokens)} tok · {usd(turnCost.usd)}
              </span>
            )}
            <Button variant="secondary" onClick={reset} disabled={busy}>
              New chat
            </Button>
          </div>
        }
      >
        {voice.unavailableReason && (
          <p className="mb-3 text-xs text-warn-ink bg-warn-soft border border-warn rounded px-2 py-1.5">
            <span aria-hidden="true">! </span>
            {voice.unavailableReason}
          </p>
        )}
        {voice.error && (
          <p className="mb-3 text-xs text-danger-ink bg-danger-soft border border-danger rounded px-2 py-1.5">
            {voice.error}
          </p>
        )}

        <div
          ref={scroller}
          className="flex-1 min-h-chat max-h-chat overflow-y-auto space-y-3 pr-1"
        >
          {items.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-ink-muted">
                Ask about spend, budgets, policies or forecasts — or tell me to change something.
                I run read-only lookups and low-risk changes directly, and stop for your
                confirmation before anything destructive.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submitText(s)}
                    className={cn(
                      'text-xs text-left border border-edge rounded-full px-3 py-1.5',
                      'text-ink hover:bg-surface-muted',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring'
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {items.map((item) => (
            <Item key={item.id} item={item} busy={busy} onDecide={decide} />
          ))}

          {busy && <Working label={status || 'Thinking…'} />}
        </div>

        {/* Live regions: dictation and agent progress are announced without stealing focus. */}
        <p aria-live="polite" className="sr-only">
          {status}
        </p>
        <div aria-live="polite" className="mt-2 min-h-line">
          {voice.interim && (
            <p className="text-xs text-ink-muted italic">
              <span className="sr-only">Heard so far: </span>
              {voice.interim}…
            </p>
          )}
        </div>

        <form
          className="mt-2 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitText(input);
          }}
        >
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitText(input);
              }
            }}
            placeholder="Ask or instruct… (Enter to send, Shift+Enter for a new line)"
            aria-label="Message the assistant"
            className={cn(
              'flex-1 text-sm border border-edge-strong rounded px-2 py-1.5 resize-none bg-surface',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring'
            )}
          />
          <Button type="submit" disabled={busy || !input.trim()} className="py-2">
            {busy ? 'Working…' : 'Send'}
          </Button>
        </form>

        <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
          <VoiceControls voice={voice} disabled={busy} />
          <span className="text-xs text-ink-faint">Hold the mic, or Ctrl+Shift+M</span>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Assistant's own spend (dogfooding)">
          {spend ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="tokens metered" value={fmt(spend.totalTokens)} sub={usd(spend.costUsd)} />
                <Stat label="LLM calls" value={fmt(spend.requests)} sub={`${spend.toolCalls} tool calls`} />
              </div>
              {spend.budget && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-ink-body">{spend.budget.name}</span>
                    <span className="text-ink-muted">
                      {fmt(spend.totalTokens)} / {fmt(spend.budget.hardLimit)}{' '}
                      {spend.budget.metric === 'COST_USD' ? '$' : 'tok'}
                    </span>
                  </div>
                  <UtilBar v={spend.budget.utilization} label={`${spend.budget.name} utilization`} />
                  <p className="text-xs text-ink-faint mt-1">
                    {pct(spend.budget.utilization)} used · resets{' '}
                    {spend.budget.resetPeriod.toLowerCase()}
                  </p>
                </div>
              )}
              <p className="text-xs text-ink-faint">
                Agent <code className="text-ink">{spend.agent}</code>
                {spend.paused && <Badge text="paused" tone="danger" />} runs through the same
                gateway as your agents. It appears in Spend by agent, and its budget can block it.
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-faint">Loading…</p>
          )}
        </Card>

        <Card title="Capabilities">
          {tools ? (
            <div className="space-y-2 text-xs">
              <p className="text-ink-muted">
                {tools.tools.length} tools · provider{' '}
                <code className="text-ink">{tools.provider}</code> · model{' '}
                <code className="text-ink">{tools.model}</code>
              </p>
              <div>
                <p className="text-ink-faint mb-1">Always asks first</p>
                <div className="flex flex-wrap gap-1">
                  {tools.alwaysConfirm.map((t) => (
                    <Badge key={t} text={t} tone="danger" />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-ink-faint mb-1">Asks when the arguments are risky</p>
                <div className="flex flex-wrap gap-1">
                  {tools.conditionallyConfirm.map((t) => (
                    <Badge key={t} text={t} tone="gate" />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-ink-faint mb-1">Runs directly</p>
                <div className="flex flex-wrap gap-1">
                  {tools.tools
                    .filter((t) => !gated.includes(t.name))
                    .map((t) => (
                      <Badge key={t.name} text={t.name} tone="neutral" />
                    ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-faint">Loading…</p>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Progress for the in-flight turn. Text carries the state; dots are decoration. */
function Working({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-ink-faint">
      <span className="inline-flex items-end gap-0.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1 h-1 rounded-full bg-ink-faint animate-bar-bounce motion-reduce:animate-none"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
      {label}
    </p>
  );
}

function Item({
  item,
  busy,
  onDecide,
}: {
  item: Item;
  busy: boolean;
  onDecide: (call: ToolCallView, approve: boolean) => void;
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="flex justify-end">
          <p className="max-w-bubble text-sm bg-accent text-ink-inverse rounded-lg rounded-br-none px-3 py-2 whitespace-pre-wrap">
            {item.text}
          </p>
        </div>
      );
    case 'assistant':
      return (
        <div className="flex justify-start">
          <div className="max-w-bubble text-sm bg-surface-muted border border-edge text-ink-body rounded-lg rounded-bl-none px-3 py-2 whitespace-pre-wrap">
            {item.text}
          </div>
        </div>
      );
    case 'tool':
      return <ToolCallCard call={item.call} tokens={item.tokens} costUsd={item.costUsd} />;
    case 'confirm':
      return item.decided ? (
        <p className="text-xs text-ink-muted">
          {item.decided === 'approved' ? 'Confirmed' : 'Cancelled'}{' '}
          <code className="text-ink">{item.call.tool}</code>.
        </p>
      ) : (
        <ConfirmPrompt call={item.call} busy={busy} onDecide={(ok) => onDecide(item.call, ok)} />
      );
    case 'notice':
      return (
        <p
          className={cn(
            'text-sm rounded px-2 py-1.5 border',
            item.tone === 'danger'
              ? 'text-danger-ink bg-danger-soft border-danger'
              : item.tone === 'warn'
                ? 'text-warn-ink bg-warn-soft border-warn'
                : 'text-info-ink bg-info-soft border-info'
          )}
        >
          {item.text}
        </p>
      );
  }
}
