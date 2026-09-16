import { getEncoding, type Tiktoken } from 'js-tiktoken';

export interface ChatMessage {
  role: string;
  content: string;
  name?: string;
}

export interface Scope {
  projectId?: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  taskId?: string;
}

export type Decision =
  | 'allow' | 'warn' | 'degrade' | 'compress' | 'summarize'
  | 'truncate' | 'require-approval' | 'stop-agent' | 'retry-limit' | 'tool-limit';

export interface CheckResult {
  requestId: string | null;
  decision: Decision;
  allowed: boolean;
  reason: string;
  forecast: {
    promptTokens: number;
    expectedCompletionTokens: number;
    reservedTokens: number;
    estimatedCostUsd: number;
    overflowRisk: boolean;
  };
  budgets: unknown[];
  recommendedModel?: string;
  signals: { signatureRepeats: number; failedAttempts: number };
  promptCache?: { hit: boolean; priorRequestId?: string; suggestedCachedTokens?: number; hint?: string };
}

export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  toolTokens?: number;
}

export class BudgetExceededError extends Error {
  decision: Decision;
  check: CheckResult;
  constructor(check: CheckResult) {
    super(`Budget enforcement blocked the call (${check.decision}): ${check.reason}`);
    this.name = 'BudgetExceededError';
    this.decision = check.decision;
    this.check = check;
  }
}

function encodingForModel(model: string): 'o200k_base' | 'cl100k_base' {
  if (/^(gpt-4o|gpt-4\.1|o1|o3|o4|gpt-5|chatgpt-4o)/i.test(model)) return 'o200k_base';
  return 'cl100k_base';
}
const encCache = new Map<string, Tiktoken>();
function enc(name: 'o200k_base' | 'cl100k_base'): Tiktoken {
  let e = encCache.get(name);
  if (!e) { e = getEncoding(name); encCache.set(name, e); }
  return e;
}

export interface ClientOptions {
  baseUrl?: string;
  apiKey: string;
  /** Default scope merged into every call. */
  scope?: Scope;
  fetchImpl?: typeof fetch;
}

/**
 * Token Budget Manager SDK client. Wraps the TBM REST API and provides local,
 * accurate token estimation (tiktoken) with a chars/4 fallback.
 */
export class TokenBudgetClient {
  private baseUrl: string;
  private apiKey: string;
  private scope: Scope;
  private fetchImpl: typeof fetch;

  constructor(opts: ClientOptions) {
    this.baseUrl = (opts.baseUrl ?? 'http://localhost:4000').replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.scope = opts.scope ?? {};
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Accurate local token estimate with heuristic fallback. */
  estimateTokens(input: string | ChatMessage[], model = 'gpt-4o-mini'): number {
    const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
    try {
      const e = enc(encodingForModel(model));
      let tokens = 3;
      for (const m of messages) {
        tokens += 3 + e.encode(m.content ?? '').length + e.encode(m.role ?? '').length;
        if (m.name) tokens += e.encode(m.name).length;
      }
      return tokens;
    } catch {
      let chars = 0;
      for (const m of messages) chars += (m.content ?? '').length + 4;
      return Math.ceil(chars / 4) + 3;
    }
  }

  private async req<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok && res.status !== 402) {
      throw new Error(`TBM ${path} failed ${res.status}: ${text.slice(0, 300)}`);
    }
    return data as T;
  }

  /** Pre-request gateway: estimate + budget check + policy decision + reservation. */
  async beforeLLMCall(params: {
    model: string;
    messages: ChatMessage[];
    provider?: string;
    expectedCompletionTokens?: number;
    toolCalls?: number;
    scope?: Scope;
  }): Promise<CheckResult> {
    return this.req<CheckResult>('/v1/check-budget', {
      model: params.model,
      provider: params.provider,
      messages: params.messages,
      expectedCompletionTokens: params.expectedCompletionTokens,
      toolCalls: params.toolCalls,
      scope: { ...this.scope, ...params.scope },
    });
  }

  /** Throw if the decision blocks the call; otherwise return the check. */
  enforceBudget(check: CheckResult): CheckResult {
    if (!check.allowed) throw new BudgetExceededError(check);
    return check;
  }

  /** Post-request accounting of actual usage (idempotent per requestId). */
  async afterLLMCall(params: { requestId: string; usage: UsageTokens; model?: string; status?: 'completed' | 'failed' }) {
    return this.req('/v1/record-usage', params);
  }

  /** Record standalone tool-call token usage. */
  async recordToolUsage(params: { tool: string; toolTokens: number; model?: string; scope?: Scope }) {
    return this.req('/v1/record-tool-usage', {
      tool: params.tool,
      toolTokens: params.toolTokens,
      model: params.model,
      scope: { ...this.scope, ...params.scope },
    });
  }

  /** Ask the server for the cheapest model that fits the prompt and remaining budget. */
  async chooseModel(params: {
    requestedModel: string;
    promptTokens: number;
    expectedCompletionTokens?: number;
    remainingBudgetUsd?: number;
    remainingBudgetTokens?: number;
    preferCheaper?: boolean;
  }) {
    return this.req<{
      model: string;
      reason: string;
      estimatedCostUsd: number;
      fitsRemainingBudget: boolean;
    }>('/v1/optimize/choose-model', {
      requestedModel: params.requestedModel,
      promptTokens: params.promptTokens,
      expectedCompletionTokens: params.expectedCompletionTokens,
      remainingBudgetUsd: params.remainingBudgetUsd,
      remainingBudgetTokens: params.remainingBudgetTokens,
      preferCheaper: params.preferCheaper ?? true,
    });
  }

  /** Forecast whether a multi-step agent run will exceed hierarchical budgets. */
  async forecastRun(params: {
    model: string;
    estimatedSteps: number;
    avgPromptTokens: number;
    avgCompletionTokens: number;
    toolCallsPerStep?: number;
    avgToolTokens?: number;
    scope?: Scope;
  }) {
    return this.req('/v1/forecast/run', {
      ...params,
      scope: { ...this.scope, ...params.scope },
    });
  }

  /** Counterfactual $ / tokens saved by policy decisions. */
  async getSavingsLedger() {
    return this.req('/v1/analytics/savings-ledger', undefined, 'GET');
  }

  /** Chargeback / showback rows (agent, task, project, or user). */
  async getChargeback(params: { groupBy?: 'agent' | 'task' | 'project' | 'user'; from?: string; to?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.groupBy) qs.set('groupBy', params.groupBy);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    const q = qs.toString();
    return this.req(`/v1/analytics/chargeback${q ? `?${q}` : ''}`, undefined, 'GET');
  }

  async exportPolicyPack() {
    return this.req('/v1/policy-packs/export', undefined, 'GET');
  }

  async importPolicyPack(params: { packId?: string; pack?: unknown; scopeBindings?: Scope }) {
    return this.req('/v1/policy-packs/import', params);
  }

  /** Compress context (dedupe -> summarize -> prune) to fit a token target. */
  async compressContextIfNeeded(params: { model: string; messages: ChatMessage[]; targetTokens: number }) {
    return this.req<{ messages: ChatMessage[]; applied: string[]; before: number; after: number }>(
      '/v1/optimize/compress', params
    );
  }

  /** Convenience: full check -> provider call -> record via the server. */
  async complete(params: {
    model: string;
    messages: ChatMessage[];
    provider?: string;
    maxTokens?: number;
    autoCompress?: boolean;
    scope?: Scope;
  }) {
    return this.req<any>('/v1/llm/complete', {
      ...params,
      provider: params.provider ?? 'mock',
      scope: { ...this.scope, ...params.scope },
    });
  }
}

export default TokenBudgetClient;
