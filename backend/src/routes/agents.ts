import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { requireRole } from '../auth.js';
import { writeAudit } from '../services/audit.js';
import { emitEvent } from '../services/events.js';
import { actor, orgId } from './context.js';

function setStatus(status: 'paused' | 'active') {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const organizationId = orgId(req);
    const agent = await prisma.agent.findFirst({ where: { id, project: { organizationId } } });
    if (!agent) return reply.code(404).send({ error: 'agent not found' });
    const updated = await prisma.agent.update({ where: { id }, data: { status } });
    await writeAudit({
      organizationId,
      actor: actor(req),
      action: status === 'paused' ? 'agent.pause' : 'agent.resume',
      target: id,
      metadata: { agentName: agent.name, previousStatus: agent.status },
    });
    await emitEvent({
      organizationId,
      type: status === 'paused' ? 'agent_paused' : 'agent_resumed',
      data: { agentId: id, agentName: agent.name },
    }).catch(() => {});
    return updated;
  };
}

export async function registerAgentRoutes(v1: FastifyInstance) {
  v1.post('/agents/:id/pause', { preHandler: requireRole('member') }, setStatus('paused'));
  v1.post('/agents/:id/resume', { preHandler: requireRole('member') }, setStatus('active'));

  // Directory helper for the dashboard.
  v1.get('/agents', async (req) =>
    prisma.agent.findMany({ where: { project: { organizationId: orgId(req) } } })
  );
}
