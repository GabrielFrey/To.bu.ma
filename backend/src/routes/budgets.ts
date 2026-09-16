import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRole } from '../auth.js';
import { writeAudit } from '../services/audit.js';
import { actor, orgId } from './context.js';
import {
  budgetLevelSchema,
  budgetMetricSchema,
  fallbackBehaviorSchema,
  policyActionSchema,
  resetPeriodSchema,
} from './schemas.js';

const createBudgetSchema = z.object({
  name: z.string().min(1),
  level: budgetLevelSchema,
  scopeId: z.string().optional(),
  metric: budgetMetricSchema.default('TOKENS'),
  hardLimit: z.number().positive(),
  softLimit: z.number().positive().optional(),
  warningThreshold: z.number().min(0).max(1).default(0.8),
  resetPeriod: resetPeriodSchema.default('MONTHLY'),
  priority: z.number().int().default(5),
  fallbackBehavior: fallbackBehaviorSchema.default('BLOCK'),
});

const updateBudgetSchema = z.object({
  name: z.string().min(1).optional(),
  hardLimit: z.number().positive().optional(),
  softLimit: z.number().positive().optional(),
  warningThreshold: z.number().min(0).max(1).optional(),
  resetPeriod: resetPeriodSchema.optional(),
  priority: z.number().int().optional(),
  fallbackBehavior: fallbackBehaviorSchema.optional(),
  active: z.boolean().optional(),
});

const createPolicySchema = z.object({
  budgetId: z.string(),
  name: z.string().min(1),
  condition: z.string().min(1),
  action: policyActionSchema,
  params: z.record(z.unknown()).optional(),
  priority: z.number().int().default(5),
});

export async function registerBudgetRoutes(v1: FastifyInstance) {
  v1.post('/budgets', { preHandler: requireRole('admin') }, async (req, reply) => {
    const body = createBudgetSchema.parse(req.body);
    const budget = await prisma.budget.create({
      data: { ...body, organizationId: orgId(req) },
    });
    await writeAudit({
      organizationId: orgId(req),
      actor: actor(req),
      action: 'budget.create',
      target: budget.id,
      metadata: { name: budget.name, level: budget.level, metric: budget.metric, hardLimit: budget.hardLimit },
    });
    return reply.code(201).send(budget);
  });

  v1.patch('/budgets/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateBudgetSchema.parse(req.body);
    const existing = await prisma.budget.findFirst({ where: { id, organizationId: orgId(req) } });
    if (!existing) return reply.code(404).send({ error: 'budget not found' });
    const budget = await prisma.budget.update({ where: { id }, data: body });
    await writeAudit({
      organizationId: orgId(req),
      actor: actor(req),
      action: 'budget.update',
      target: id,
      metadata: {
        name: budget.name,
        changed: body,
        previousHardLimit: existing.hardLimit,
        raisedHardLimit: body.hardLimit != null && body.hardLimit > existing.hardLimit,
      },
    });
    return budget;
  });

  v1.delete('/budgets/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.budget.findFirst({ where: { id, organizationId: orgId(req) } });
    if (!existing) return reply.code(404).send({ error: 'budget not found' });
    await prisma.budgetPolicy.deleteMany({ where: { budgetId: id } });
    await prisma.policyEvent.updateMany({ where: { budgetId: id }, data: { budgetId: null } });
    await prisma.budget.delete({ where: { id } });
    await writeAudit({
      organizationId: orgId(req),
      actor: actor(req),
      action: 'budget.delete',
      target: id,
      metadata: { name: existing.name, level: existing.level, hardLimit: existing.hardLimit },
    });
    return reply.send({ deleted: true, id });
  });

  v1.get('/budgets', async (req) =>
    prisma.budget.findMany({
      where: { organizationId: orgId(req) },
      include: { policies: true },
    })
  );

  v1.post('/policies', { preHandler: requireRole('admin') }, async (req, reply) => {
    const body = createPolicySchema.parse(req.body);
    const budget = await prisma.budget.findFirst({
      where: { id: body.budgetId, organizationId: orgId(req) },
    });
    if (!budget) return reply.code(404).send({ error: 'budget not found' });
    const policy = await prisma.budgetPolicy.create({
      data: {
        budgetId: body.budgetId,
        name: body.name,
        condition: body.condition,
        action: body.action,
        params: body.params ? JSON.stringify(body.params) : null,
        priority: body.priority,
      },
    });
    await writeAudit({
      organizationId: orgId(req),
      actor: actor(req),
      action: 'policy.create',
      target: policy.id,
      metadata: { budgetId: body.budgetId, name: body.name, condition: body.condition, action: body.action },
    });
    return reply.code(201).send(policy);
  });

  v1.get('/policies', async (req) =>
    prisma.budgetPolicy.findMany({
      where: { budget: { organizationId: orgId(req) } },
      orderBy: { priority: 'desc' },
    })
  );
}
