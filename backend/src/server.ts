import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { registerRoutes } from './routes/index.js';
import { registerProxyRoutes } from './routes/proxy.js';
import { expireStaleReservations } from './services/accounting.js';
import { initTelemetry } from './telemetry.js';

/** Rate-limit bucket: the caller's key however they sent it, else their IP. */
function rateLimitKey(req: { headers: Record<string, unknown>; ip: string }): string {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey) return apiKey;
  const authz = req.headers['authorization'];
  if (typeof authz === 'string' && authz.toLowerCase().startsWith('bearer ')) return authz.slice(7).trim();
  return req.ip;
}

export async function buildServer() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: config.bodyLimitBytes,
  });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => rateLimitKey(req as never),
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', issues: err.issues });
    }
    const status = err.statusCode ?? 500;
    // Deliberate 4xx messages are part of the API contract. Unexpected 5xx text
    // is not: Prisma errors name tables and columns, and "unknown request <id>"
    // is a tenant-existence oracle. Log it, return something generic.
    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
      return reply.code(status).send({ error: 'internal error' });
    }
    reply.code(status).send({ error: err.message });
  });

  await registerRoutes(app);
  await registerProxyRoutes(app);
  return app;
}

// Only start listening when run directly (not when imported by tests).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  // Optional OpenTelemetry export (no-op unless an OTLP endpoint is configured).
  initTelemetry();
  buildServer()
    .then((app) => app.listen({ port: config.port, host: '0.0.0.0' }))
    .then((addr) => {
      console.log(`TBM backend listening on ${addr}`);
      const intervalMs = Math.max(30_000, Math.floor(config.reservationTtlMs / 2));
      const timer = setInterval(() => {
        expireStaleReservations().catch((err) => {
          console.error('reservation TTL sweep failed', err);
        });
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
