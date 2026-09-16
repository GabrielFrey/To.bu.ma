import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRole } from '../auth.js';
import { writeAudit } from '../services/audit.js';
import { emitEvent, EVENT_TYPES } from '../services/events.js';
import { actor, orgId } from './context.js';

const createWebhookSchema = z.object({
  kind: z.enum(['generic', 'slack', 'http', 'email']).default('generic'),
  url: z.string().url().optional(),
  target: z.string().optional(), // email address for kind=email
  secret: z.string().optional(),
  events: z.union([z.literal('all'), z.array(z.enum(EVENT_TYPES))]).default('all'),
});

export async function registerWebhookRoutes(v1: FastifyInstance) {
  v1.post('/webhooks', { preHandler: requireRole('admin') }, async (req, reply) => {
    const body = createWebhookSchema.parse(req.body);
    if (body.kind === 'email' && !body.target) {
      return reply.code(400).send({ error: 'email channel requires target' });
    }
    if (body.kind !== 'email' && !body.url) {
      return reply.code(400).send({ error: 'this channel requires url' });
    }
    const wh = await prisma.webhook.create({
      data: {
        organizationId: orgId(req),
        kind: body.kind,
        url: body.url,
        target: body.target,
        secret: body.secret ?? 'whsec_' + randomBytes(24).toString('hex'),
        events: Array.isArray(body.events) ? body.events.join(',') : 'all',
      },
    });
    await writeAudit({
      organizationId: orgId(req),
      actor: actor(req),
      action: 'webhook.create',
      target: wh.id,
      metadata: { kind: wh.kind, url: wh.url, events: wh.events },
    });
    return reply.code(201).send(wh);
  });

  v1.get('/webhooks', async (req) =>
    prisma.webhook.findMany({ where: { organizationId: orgId(req) }, orderBy: { createdAt: 'desc' } })
  );

  v1.delete('/webhooks/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const wh = await prisma.webhook.findFirst({ where: { id, organizationId: orgId(req) } });
    if (!wh) return reply.code(404).send({ error: 'webhook not found' });
    await prisma.webhookDelivery.deleteMany({ where: { webhookId: id } });
    await prisma.webhook.delete({ where: { id } });
    await writeAudit({
      organizationId: orgId(req),
      actor: actor(req),
      action: 'webhook.delete',
      target: id,
      metadata: { kind: wh.kind, url: wh.url },
    });
    return reply.send({ deleted: true });
  });

  v1.get('/webhooks/:id/deliveries', async (req, reply) => {
    const { id } = req.params as { id: string };
    const wh = await prisma.webhook.findFirst({ where: { id, organizationId: orgId(req) } });
    if (!wh) return reply.code(404).send({ error: 'webhook not found' });
    return prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  // Fire a synthetic event to test wiring.
  v1.post('/webhooks/test', { preHandler: requireRole('admin') }, async (req) => {
    const result = await emitEvent({
      organizationId: orgId(req),
      type: 'warning_threshold',
      data: { budgetName: 'test budget', utilization: 0.85, test: true },
    });
    return { emitted: true, ...result };
  });

  v1.get('/events', async (req) =>
    prisma.eventLog.findMany({
      where: { organizationId: orgId(req) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  );
}
