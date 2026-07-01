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
};
