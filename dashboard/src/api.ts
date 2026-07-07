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
};
