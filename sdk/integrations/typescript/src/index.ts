/**
 * Thin TBM framework adapters for TypeScript.
 *
 * Design: these route through the **Phase 1 transparent proxy** rather than
 * re-implementing budget logic. That keeps a single enforcement path and means
 * every framework benefits from budgets/policies/optimization automatically.
 *
 * The framework packages (`@ai-sdk/openai`, `@langchain/openai`) are OPTIONAL
 * peer deps — imported dynamically so this module typechecks and installs
 * without them. Install the one you use.
 */

export interface TBMScope {
  project?: string;
  agent?: string;
  session?: string;
  task?: string;
  user?: string;
}

export interface TBMConnectOptions {
  /** TBM base URL, e.g. http://localhost:4000 (the "/v1" is added for you). */
  baseUrl?: string;
  /** Your TBM API key (used where the OpenAI key would go). */
  apiKey: string;
  /** Optional default attribution applied to every call via X-TBM-* headers. */
  scope?: TBMScope;
  /** Force upstream mode for demos/tests: 'mock' | 'openai'. */
  upstream?: 'mock' | 'openai';
}

/** Build the X-TBM-* headers from a scope (+ optional upstream override). */
export function tbmHeaders(scope?: TBMScope, upstream?: 'mock' | 'openai'): Record<string, string> {
  const h: Record<string, string> = {};
  if (scope?.project) h['X-TBM-Project'] = scope.project;
  if (scope?.agent) h['X-TBM-Agent'] = scope.agent;
  if (scope?.session) h['X-TBM-Session'] = scope.session;
  if (scope?.task) h['X-TBM-Task'] = scope.task;
  if (scope?.user) h['X-TBM-User'] = scope.user;
  if (upstream) h['X-TBM-Upstream'] = upstream;
  return h;
}

/** Plain config object usable by any OpenAI-compatible client. */
export function tbmClientConfig(opts: TBMConnectOptions) {
  const baseURL = `${(opts.baseUrl ?? 'http://localhost:4000').replace(/\/$/, '')}/v1`;
  return { baseURL, apiKey: opts.apiKey, headers: tbmHeaders(opts.scope, opts.upstream) };
}

/**
 * Vercel AI SDK: returns an OpenAI provider pointed at the TBM proxy. Use its
 * result exactly like `openai` from `@ai-sdk/openai`.
 *
 *   const openai = await tbmOpenAIProvider({ apiKey: 'tbm_...', scope: { agent: 'bot' } });
 *   const { text } = await generateText({ model: openai('gpt-4o-mini'), prompt: 'hi' });
 */
export async function tbmOpenAIProvider(opts: TBMConnectOptions): Promise<any> {
  const spec = '@ai-sdk/openai';
  const mod: any = await import(/* @vite-ignore */ spec);
  const cfg = tbmClientConfig(opts);
  return mod.createOpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey, headers: cfg.headers });
}

/**
 * LangChain.js: returns a ChatOpenAI bound to the TBM proxy.
 *
 *   const model = await tbmChatOpenAI({ apiKey: 'tbm_...', scope: { agent: 'bot' } }, { model: 'gpt-4o-mini' });
 *   await model.invoke('hi');
 */
export async function tbmChatOpenAI(opts: TBMConnectOptions, chatOptions: Record<string, unknown> = {}): Promise<any> {
  const spec = '@langchain/openai';
  const mod: any = await import(/* @vite-ignore */ spec);
  const cfg = tbmClientConfig(opts);
  return new mod.ChatOpenAI({
    model: (chatOptions.model as string) ?? 'gpt-4o-mini',
    apiKey: cfg.apiKey,
    ...chatOptions,
    configuration: { baseURL: cfg.baseURL, defaultHeaders: cfg.headers },
  });
}
