import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { registerRoutes } from './routes.js';
import { registerProxyRoutes } from './routes/proxy.js';

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req.headers['x-api-key'] as string) ?? req.ip,
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', issues: err.issues });
    }
    reply.code(err.statusCode ?? 500).send({ error: err.message });
  });

  await registerRoutes(app);
  await registerProxyRoutes(app);
  return app;
}

// Only start listening when run directly (not when imported by tests).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  buildServer()
    .then((app) => app.listen({ port: config.port, host: '0.0.0.0' }))
    .then((addr) => console.log(`TBM backend listening on ${addr}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
