const KEY_STORAGE = 'tbm_api_key';
const URL_STORAGE = 'tbm_base_url';

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? 'tbm_demo_local_key';
}
export function setApiKey(k: string) {
  localStorage.setItem(KEY_STORAGE, k);
}
export function getBaseUrl(): string {
  // Empty string => same-origin (uses the Vite proxy in dev).
  return localStorage.getItem(URL_STORAGE) ?? '';
}
export function setBaseUrl(u: string) {
  localStorage.setItem(URL_STORAGE, u);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: { 'x-api-key': getApiKey() },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface TotalSpend {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  toolTokens: number;
  costUsd: number;
  requests: number;
}
export interface AgentSpend { agentId: string | null; agentName: string; totalTokens: number; costUsd: number; requests: number; }
export interface TaskSpend { taskId: string | null; taskName: string; totalTokens: number; costUsd: number; requests: number; }
export interface BudgetStatus {
  budgetId: string; name: string; level: string; metric: string; hardLimit: number;
  used: number; reserved: number; remaining: number; utilization: number;
  exceedsHard: boolean; exceedsSoft: boolean; atWarning: boolean;
}
export interface PolicyEvent { id: string; decision: string; reason: string; utilization: number | null; createdAt: string; }
export interface ExpensivePrompt { requestId: string; model: string; totalTokens: number; costUsd: number; agentId: string | null; taskId: string | null; }
export interface LoopRow { sessionId: string | null; signature: string | null; repeats: number; }
export interface Recommendation { type: string; message: string; severity: 'info' | 'warn'; }

export interface SavingsLedger {
  totalSavedUsd: number;
  totalSavedTokens: number;
  blockedRequests: number;
  optimizedRequests: number;
  byDecision: { decision: string; count: number; savedUsd: number; savedTokens: number }[];
  topReasons: { reason: string; savedUsd: number; count: number }[];
  note: string;
}

export interface RunForecast {
  projectedRunTokens: number;
  projectedRunCostUsd: number;
  willExceedHardLimit: boolean;
  stepsUntilHardLimit: number;
  recommendation: string;
  reason: string;
  limitingBudget: { name: string; level: string } | null;
}

export const api = {
  total: () => get<TotalSpend>('/v1/analytics/total'),
  byAgent: () => get<AgentSpend[]>('/v1/analytics/by-agent'),
  byTask: () => get<TaskSpend[]>('/v1/analytics/by-task'),
  byProject: () => get<{ projectId: string | null; projectName: string; totalTokens: number; costUsd: number; requests: number }[]>('/v1/analytics/by-project'),
  activeBudgets: () => get<BudgetStatus[]>('/v1/analytics/active-budgets'),
  warnings: () => get<PolicyEvent[]>('/v1/analytics/warnings'),
  blocked: () => get<PolicyEvent[]>('/v1/analytics/blocked'),
  expensive: () => get<ExpensivePrompt[]>('/v1/analytics/expensive-prompts'),
  loops: () => get<LoopRow[]>('/v1/analytics/loops'),
  recommendations: () => get<Recommendation[]>('/v1/analytics/recommendations'),
  savingsLedger: () => get<SavingsLedger>('/v1/analytics/savings-ledger'),
  listPolicyPacks: () => get<{ id: string; name: string; description: string; process: string }[]>('/v1/policy-packs'),
  importPolicyPack: async (packId: string) => {
    const res = await fetch(`${getBaseUrl()}/v1/policy-packs/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': getApiKey() },
      body: JSON.stringify({ packId }),
    });
    if (!res.ok) throw new Error(`/v1/policy-packs/import → ${res.status}`);
    return res.json() as Promise<{ budgetsCreated: number; policiesCreated: number; packName: string }>;
  },
  assistantTools: () => get<AssistantTools>('/v1/assistant/tools'),
  assistantSpend: () => get<AssistantSpend>('/v1/assistant/spend'),
  assistantConversations: () =>
    get<{ id: string; title: string; createdAt: string; updatedAt: string }[]>(
      '/v1/assistant/conversations'
    ),
  deleteAssistantConversation: async (id: string) => {
    const res = await fetch(`${getBaseUrl()}/v1/assistant/conversations/${id}`, {
      method: 'DELETE',
      headers: { 'x-api-key': getApiKey() },
    });
    if (!res.ok) throw new Error(`delete conversation → ${res.status}`);
  },
  downloadChargebackCsv: async (groupBy: 'agent' | 'task' | 'project' | 'user') => {
    const res = await fetch(`${getBaseUrl()}/v1/analytics/chargeback.csv?groupBy=${groupBy}`, {
      headers: { 'x-api-key': getApiKey() },
    });
    if (!res.ok) throw new Error(`/v1/analytics/chargeback.csv → ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tbm-chargeback-${groupBy}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};

// --- assistant -----------------------------------------------------------

export type Risk = 'read' | 'write' | 'destructive';

export interface AssistantTools {
  provider: string;
  model: string;
  alwaysConfirm: string[];
  conditionallyConfirm: string[];
  tools: {
    name: string;
    description: string;
    risk: Risk;
    confirmation: 'always' | 'conditional' | 'never';
  }[];
}

export interface AssistantSpend {
  agent: string;
  paused: boolean;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  conversations: number;
  toolCalls: number;
  budget: {
    id: string;
    name: string;
    metric: string;
    hardLimit: number;
    resetPeriod: string;
    utilization: number;
  } | null;
}

export interface ToolCallView {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  risk: Risk;
  status: string;
  summary: string;
  result?: unknown;
  error?: string;
  durationMs: number;
  confirm?: { reason: string; confirmToken: string; expiresAt: string };
}

export interface UsageStep {
  requestId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  decision: string;
}

export interface ChatTurnResponse {
  conversationId: string;
  reply: string;
  toolCalls: ToolCallView[];
  pendingConfirmations: ToolCallView[];
  usage: { steps: UsageStep[]; inputTokens: number; outputTokens: number; costUsd: number };
  blocked?: {
    decision: string;
    reason: string;
    budgets: { name: string; level: string; utilization: number; hardLimit: number }[];
  };
  stoppedBecause: 'answered' | 'awaiting_confirmation' | 'budget_blocked' | 'step_limit';
}

export type StreamEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'tool_call'; call: ToolCallView }
  | { type: 'tool_result'; call: ToolCallView }
  | { type: 'pending_confirmation'; call: ToolCallView }
  | { type: 'usage'; step: UsageStep }
  | { type: 'delta'; text: string }
  | { type: 'blocked'; decision: string; reason: string }
  | { type: 'done'; response: ChatTurnResponse }
  | { type: 'error'; error: string };

export interface ChatRequest {
  conversationId?: string;
  message?: string;
  confirmations?: { toolCallId: string; confirmToken: string; approve?: boolean }[];
}

/**
 * POST the turn and consume the SSE response. `EventSource` cannot be used here
 * because it is GET-only and cannot carry the API key header, so the stream is
 * read off `fetch` and framed by hand.
 */
export async function streamAssistantChat(
  body: ChatRequest,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/v1/assistant/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': getApiKey() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = res.ok ? 'no response body' : `HTTP ${res.status}`;
    throw new Error(`assistant chat failed (${detail})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line; keep any partial tail.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('');
      if (!data || data === '{}') continue;
      try {
        onEvent(JSON.parse(data) as StreamEvent);
      } catch {
        /* ignore a frame we cannot parse rather than killing the stream */
      }
    }
  }
}
