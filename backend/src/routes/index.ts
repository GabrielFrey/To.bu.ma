import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { authenticate } from '../auth.js';
import { registerAssistantRoutes } from '../assistant/routes.js';
import { registerAgentRoutes } from './agents.js';
import { registerAnalyticsRoutes } from './analytics.js';
import { registerApprovalRoutes, registerPublicApprovalRoutes } from './approvals.js';
import { registerBudgetRoutes } from './budgets.js';
import { registerGatewayRoutes } from './gateway.js';
import { registerPolicyPackRoutes } from './policyPacks.js';
import { registerWebhookRoutes } from './webhooks.js';

/**
 * Route composition. Each module owns one concern and one Zod surface; the only
 * thing this file decides is what is public and what sits behind `authenticate`.
 */
export async function registerRoutes(app: FastifyInstance) {
  // Liveness: process is up.
  app.get('/health', async () => ({ ok: true, service: 'tbm-backend' }));

  // Readiness: dependencies (DB) reachable. Used by Docker/K8s health checks.
  app.get('/ready', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ready: true };
    } catch (err) {
      return reply.code(503).send({ ready: false, error: (err as Error).message });
    }
  });

  // Signed-token approval links carry their own proof, so they sit outside auth.
  await registerPublicApprovalRoutes(app);

  await app.register(
    async (v1) => {
      v1.addHook('preHandler', authenticate);
      await registerBudgetRoutes(v1);
      await registerGatewayRoutes(v1);
      await registerAgentRoutes(v1);
      await registerApprovalRoutes(v1);
      await registerWebhookRoutes(v1);
      await registerAnalyticsRoutes(v1);
      await registerPolicyPackRoutes(v1);
      await registerAssistantRoutes(v1);
    },
    { prefix: '/v1' }
  );
}
