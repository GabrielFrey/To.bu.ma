import { estimateTokens } from '../tokenizer.js';
import type {
  ChatRequest,
  ChatResult,
  CompletionRequest,
  CompletionResult,
  Provider,
  ToolCallRequest,
} from './types.js';

/**
 * Deterministic offline provider for tests and the demo. Produces a canned
 * response and a realistic `usage` object derived from tiktoken estimates so
 * the full check → call → record → analytics flow works with no network.
 */

/** Pull the first quoted string, else the first capitalised/hyphenated token. */
function extractName(text: string): string | undefined {
  const quoted = text.match(/["'“”]([^"'“”]{2,64})["'“”]/);
  if (quoted) return quoted[1].trim();
  const named = text.match(/\b(?:named|called|for agent|agent|budget)\s+([\w-]{2,64})/i);
  return named?.[1];
}

/** Parse "$25", "200k tokens", "1_000_000" into a number. */
function extractNumber(text: string): number | undefined {
  const m = text.match(/\$?\s*([\d][\d_,.]*)\s*(k|m|thousand|million)?/i);
  if (!m) return undefined;
  const base = Number(m[1].replace(/[_,]/g, ''));
  if (!Number.isFinite(base)) return undefined;
  const suffix = (m[2] ?? '').toLowerCase();
  if (suffix === 'k' || suffix === 'thousand') return base * 1_000;
  if (suffix === 'm' || suffix === 'million') return base * 1_000_000;
  return base;
}

interface PlanRule {
  test: RegExp;
  tool: string;
  args: (text: string) => Record<string, unknown>;
}

/**
 * Ordered intent rules. Deliberately keyword-driven and deterministic: the same
 * prompt always yields the same tool call, which is what makes the assistant
 * testable and demoable with no API key. Destructive intents are matched *before*
 * their read-only cousins so the confirmation path is reachable offline.
 */
const PLAN_RULES: PlanRule[] = [
  { test: /\b(delete|remove|drop)\b[\s\S]*budget/i, tool: 'delete_budget', args: (t) => ({ name: extractName(t) }) },
  {
    test: /\b(raise|increase|bump|lift|double)\b[\s\S]*\b(limit|budget|cap)\b/i,
    tool: 'update_budget',
    args: (t) => ({ name: extractName(t), hardLimit: extractNumber(t) }),
  },
  {
    test: /\b(lower|reduce|tighten|decrease)\b[\s\S]*\b(limit|budget|cap)\b/i,
    tool: 'update_budget',
    args: (t) => ({ name: extractName(t), hardLimit: extractNumber(t) }),
  },
  {
    test: /\b(create|add|set up|make|new)\b[\s\S]*\bbudget\b/i,
    tool: 'create_budget',
    args: (t) => ({
      name: extractName(t) ?? 'Assistant-created budget',
      level: /\bagent\b/i.test(t) ? 'AGENT' : /\bproject\b/i.test(t) ? 'PROJECT' : 'ORGANIZATION',
      metric: /\$|usd|dollar|cost/i.test(t) ? 'COST_USD' : 'TOKENS',
      hardLimit: extractNumber(t) ?? 100_000,
    }),
  },
  {
    test: /\b(create|add|new)\b[\s\S]*\bpolic/i,
    tool: 'create_policy',
    args: (t) => ({ name: extractName(t) ?? 'Assistant policy', condition: 'utilization>=0.8', action: 'WARN' }),
  },
  { test: /\b(pause|halt|stop)\b[\s\S]*agent/i, tool: 'pause_agent', args: (t) => ({ name: extractName(t) }) },
  { test: /\b(resume|unpause|restart|re-enable)\b[\s\S]*agent/i, tool: 'resume_agent', args: (t) => ({ name: extractName(t) }) },
  { test: /\bapprove\b/i, tool: 'approve_request', args: (t) => ({ approvalId: extractName(t) }) },
  { test: /\bimport\b[\s\S]*\bpack\b/i, tool: 'import_policy_pack', args: (t) => ({ packId: extractName(t) }) },
  { test: /\b(simulate|dry ?run|what if|would happen)\b/i, tool: 'simulate_policies', args: () => ({ condition: 'loop', action: 'STOP_AGENT', name: 'simulated loop stop' }) },
  {
    test: /\b(forecast|predict|fit|afford|how many steps)\b/i,
    tool: 'forecast_run',
    args: (t) => ({ estimatedSteps: extractNumber(t) ?? 25, avgPromptTokens: 600, avgCompletionTokens: 200 }),
  },
  { test: /\b(saving|savings|roi|saved)\b/i, tool: 'get_savings_ledger', args: () => ({}) },
  { test: /\bblock(ed|s)?\b/i, tool: 'list_blocked_requests', args: () => ({}) },
  { test: /\bloop/i, tool: 'list_loops', args: () => ({}) },
  { test: /\b(chargeback|invoice|csv|finance|show ?back)\b/i, tool: 'export_chargeback_csv', args: (t) => ({ groupBy: /task/i.test(t) ? 'task' : 'agent' }) },
  { test: /\b(by|per|which|each)\b[\s\S]{0,12}\bagent/i, tool: 'get_spend_by_agent', args: () => ({}) },
  { test: /\b(by|per|which|each)\b[\s\S]{0,12}\btask/i, tool: 'get_spend_by_task', args: () => ({}) },
  { test: /\bpolic/i, tool: 'list_policies', args: () => ({}) },
  { test: /\bbudget/i, tool: 'list_budgets', args: () => ({}) },
  { test: /\b(spend|spent|cost|how much|token|usage|burn)\b/i, tool: 'get_spend_summary', args: () => ({}) },
];

/** Deterministic tool-call id so replays and snapshots are stable. */
function toolCallId(tool: string, turn: number): string {
  return `mockcall_${turn}_${tool}`;
}

function planToolCall(text: string, available: Set<string>, turn: number): ToolCallRequest | null {
  for (const rule of PLAN_RULES) {
    if (!rule.test.test(text) || !available.has(rule.tool)) continue;
    const args = Object.fromEntries(
      Object.entries(rule.args(text)).filter(([, v]) => v !== undefined && v !== null)
    );
    return { id: toolCallId(rule.tool, turn), name: rule.tool, arguments: args };
  }
  return null;
}

/** Render a tool result into one readable sentence. Shape-aware, JSON fallback. */
function describeToolResult(name: string, raw: string): string {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return `${name} returned: ${raw.slice(0, 200)}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${name} found nothing.`;
    return `${name} returned ${value.length} row(s); first: ${JSON.stringify(value[0]).slice(0, 200)}.`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const parts = Object.entries(obj)
      .filter(([, v]) => v == null || typeof v !== 'object')
      .slice(0, 6)
      .map(([k, v]) => `${k}=${String(v)}`);
    return parts.length ? `${name}: ${parts.join(', ')}.` : `${name}: ${JSON.stringify(obj).slice(0, 200)}.`;
  }
  return `${name}: ${String(value)}.`;
}

export const mockProvider: Provider = {
  name: 'mock',
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const inputTokens = estimateTokens(req.messages, req.model);
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const content = `[mock:${req.model}] echo of ${(lastUser?.content ?? '').length} chars`;
    // Emulate a completion sized to the caller's cap (or a default), never over.
    const outputTokens = Math.min(req.maxTokens ?? 64, 64);
    return {
      content,
      model: req.model,
      usage: { inputTokens, outputTokens, cachedTokens: 0, toolTokens: 0 },
    };
  },

  async chat(req: ChatRequest): Promise<ChatResult> {
    const inputTokens = estimateTokens(
      req.messages.map((m) => ({ role: m.role, content: m.content })),
      req.model
    );
    const available = new Set((req.tools ?? []).map((t) => t.name));
    const toolMessages = req.messages.filter((m) => m.role === 'tool');
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const text = lastUser?.content ?? '';

    // Once tool results are on the transcript, answer from them and stop. This is
    // what makes the mock loop terminate in exactly two provider turns.
    if (toolMessages.length > 0) {
      const summary = toolMessages
        .map((m) => describeToolResult(m.name ?? 'tool', m.content))
        .join(' ');
      const content = `Here is what I found. ${summary}`.trim();
      return {
        content,
        model: req.model,
        usage: {
          inputTokens,
          outputTokens: estimateTokens(content, req.model),
          cachedTokens: 0,
          toolTokens: 0,
        },
        toolCalls: [],
        finishReason: 'stop',
      };
    }

    const call = planToolCall(text, available, req.messages.filter((m) => m.role === 'user').length);
    if (call) {
      return {
        content: '',
        model: req.model,
        usage: { inputTokens, outputTokens: 24, cachedTokens: 0, toolTokens: 0 },
        toolCalls: [call],
        finishReason: 'tool_calls',
      };
    }

    const content =
      `[mock] I am the Token Budget Manager assistant. I can report spend, inspect budgets and ` +
      `policies, forecast a run, and change configuration. Ask me something like "how much have we ` +
      `spent?", "which agent costs most?", or "raise the org budget to 2M tokens".`;
    return {
      content,
      model: req.model,
      usage: {
        inputTokens,
        outputTokens: estimateTokens(content, req.model),
        cachedTokens: 0,
        toolTokens: 0,
      },
      toolCalls: [],
      finishReason: 'stop',
    };
  },
};
