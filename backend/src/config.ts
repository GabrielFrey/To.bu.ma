import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'file:./dev.db',
  masterKey: process.env.MASTER_KEY ?? 'dev-master-key-change-me-0123456789abcdef',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  // Where the transparent proxy forwards to: 'openai' (real upstream) or 'mock'
  // (offline, deterministic — used by tests and for demos without a real key).
  // Can be overridden per-request with the `X-TBM-Upstream` header.
  proxyUpstream: (process.env.TBM_PROXY_UPSTREAM ?? 'openai') as 'openai' | 'mock',
  // Safety margin added to reservations (fraction of expected completion).
  reservationSafetyMargin: 0.1,
  // Reservations older than this (ms) with no record are swept as expired.
  reservationTtlMs: 5 * 60 * 1000,
  // Loop / retry detection thresholds (defaults; policies can override).
  loopThreshold: 3,
  retryThreshold: 3,
  // Public base URL used to build actionable approval links in notifications.
  publicUrl: process.env.TBM_PUBLIC_URL ?? `http://localhost:${Number(process.env.PORT ?? 4000)}`,
  // ---- In-product AI assistant ----
  // Provider used for the assistant's own LLM turns. 'mock' is fully offline and
  // deterministic; 'openai' requires a key (env or an encrypted provider key).
  assistantProvider: (process.env.TBM_ASSISTANT_PROVIDER ?? 'mock') as 'mock' | 'openai',
  assistantModel: process.env.TBM_ASSISTANT_MODEL ?? 'gpt-4o-mini',
  // Default monthly token budget created for the `tbm-assistant` agent.
  assistantBudgetTokens: Number(process.env.TBM_ASSISTANT_BUDGET_TOKENS ?? 200_000),
  // Max provider round-trips per user turn (tool call -> result -> answer).
  assistantMaxSteps: Number(process.env.TBM_ASSISTANT_MAX_STEPS ?? 6),
  // How long a confirmation token for a gated tool stays valid.
  assistantConfirmTtlMs: Number(process.env.TBM_ASSISTANT_CONFIRM_TTL_MS ?? 10 * 60 * 1000),
  // approve_request above this estimated cost needs explicit human confirmation.
  assistantApprovalUsdLimit: Number(process.env.TBM_ASSISTANT_APPROVAL_USD_LIMIT ?? 1),
  // Max accepted request body. Bounds the tokenizer work a single call can cause.
  bodyLimitBytes: Number(process.env.TBM_BODY_LIMIT_BYTES ?? 4 * 1024 * 1024),
  // Outbound webhook delivery: retry with exponential backoff.
  webhookMaxAttempts: Number(process.env.TBM_WEBHOOK_MAX_ATTEMPTS ?? 5),
  webhookBackoffMs: Number(process.env.TBM_WEBHOOK_BACKOFF_MS ?? 1000),
  webhookTimeoutMs: Number(process.env.TBM_WEBHOOK_TIMEOUT_MS ?? 5000),
};
