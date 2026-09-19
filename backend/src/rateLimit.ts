import type { FastifyInstance } from 'fastify';
import { config } from './config.js';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window per-IP rate limiter, applied *in addition* to the per-key limiter
 * from `@fastify/rate-limit`. The per-key limiter buckets by API key (or IP when
 * keyless), so a single IP could otherwise multiply its allowance by rotating
 * keys. This caps total requests per source IP regardless of key.
 *
 * Limits are read from `config` on every request, so they can be tuned via env
 * (`TBM_IP_RATE_LIMIT_MAX`, `TBM_IP_RATE_LIMIT_WINDOW_MS`) or overridden in tests.
 * `max <= 0` disables the limiter entirely.
 */
export function registerIpRateLimit(app: FastifyInstance): void {
  const buckets = new Map<string, Bucket>();

  app.addHook('onRequest', async (req, reply) => {
    const max = config.ipRateLimitMax;
    if (!max || max <= 0) return; // disabled
    const windowMs = config.ipRateLimitWindowMs;
    const ip = req.ip;
    const now = Date.now();

    let bucket = buckets.get(ip);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
      if (buckets.size > 10_000) sweepExpired(buckets, now);
    }
    bucket.count++;

    const remaining = Math.max(0, max - bucket.count);
    reply.header('x-ratelimit-ip-limit', String(max));
    reply.header('x-ratelimit-ip-remaining', String(remaining));

    if (bucket.count > max) {
      const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
      reply.header('retry-after', String(retryAfterSeconds));
      return reply.code(429).send({
        error: 'Too Many Requests',
        scope: 'ip',
        retryAfterSeconds,
      });
    }
  });
}

/** Drop expired buckets so the map cannot grow without bound under IP churn. */
function sweepExpired(buckets: Map<string, Bucket>, now: number): void {
  for (const [ip, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(ip);
  }
}
