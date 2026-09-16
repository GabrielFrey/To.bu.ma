import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRole } from '../auth.js';
import { writeAudit } from '../services/audit.js';
import { emitEvent, verifyApprovalActionToken } from '../services/events.js';
import { actor, orgId } from './context.js';

/**
 * Apply an approval decision: flip the held request back to `reserved` (approve)
 * or `blocked` (deny), mark the approval, and announce it.
 */
export async function resolveApproval(params: {
  approvalId: string;
  organizationId: string;
  action: 'approve' | 'deny';
  actor: string;
  via: 'api' | 'link' | 'assistant';
}) {
  const { approvalId, organizationId, action } = params;
  const appr = await prisma.approval.findFirst({ where: { id: approvalId, organizationId } });
  if (!appr) return { ok: false as const, reason: 'not_found' as const };
  if (appr.status !== 'pending') {
    return { ok: false as const, reason: 'already_resolved' as const, status: appr.status };
  }

  await prisma.llmRequest.update({
    where: { id: appr.requestId },
    data:
      action === 'approve'
        ? { status: 'reserved', decision: 'allow' }
        : { status: 'blocked' },
  });
  const updated = await prisma.approval.update({
    where: { id: approvalId },
    data: {
      status: action === 'approve' ? 'approved' : 'denied',
      decidedBy: params.actor,
      decidedAt: new Date(),
    },
  });

  await writeAudit({
    organizationId,
    actor: params.actor,
    action: action === 'approve' ? 'approval.approve' : 'approval.deny',
    target: approvalId,
    metadata: { requestId: appr.requestId, reason: appr.reason, via: params.via },
  });
  await emitEvent({
    organizationId,
    type: 'approval_resolved',
    data: { approvalId, status: updated.status, reason: appr.reason, via: params.via },
  }).catch(() => {});

  return { ok: true as const, approval: updated };
}

/** Unauthenticated, signed-token approval link (email / Slack one-click). */
export async function registerPublicApprovalRoutes(app: FastifyInstance) {
  app.get('/v1/approvals/:id/resolve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = z.object({ action: z.enum(['approve', 'deny']), token: z.string() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'action and token required' });
    const { action, token } = q.data;
    if (!verifyApprovalActionToken(id, action, token)) {
      return reply.code(403).send({ error: 'invalid token' });
    }
    const appr = await prisma.approval.findUnique({ where: { id } });
    if (!appr) return reply.code(404).send({ error: 'approval not found' });
    const result = await resolveApproval({
      approvalId: id,
      organizationId: appr.organizationId,
      action,
      actor: 'link:signed-token',
      via: 'link',
    });
    if (!result.ok) return reply.send({ status: result.status, note: 'already resolved' });
    return reply.send({ status: result.approval.status });
  });
}

export async function registerApprovalRoutes(v1: FastifyInstance) {
  v1.get('/approvals', async (req) =>
    prisma.approval.findMany({
      where: { organizationId: orgId(req), status: 'pending' },
      orderBy: { createdAt: 'desc' },
    })
  );

  for (const action of ['approve', 'deny'] as const) {
    v1.post(`/approvals/:id/${action}`, { preHandler: requireRole('admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await resolveApproval({
        approvalId: id,
        organizationId: orgId(req),
        action,
        actor: actor(req),
        via: 'api',
      });
      if (!result.ok) {
        if (result.reason === 'not_found') return reply.code(404).send({ error: 'approval not found' });
        return reply.send({ status: result.status, note: 'already resolved' });
      }
      return result.approval;
    });
  }
}
