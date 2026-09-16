import { prisma } from '../db.js';
import type { ScopeChain } from '../types.js';

export class ScopeOwnershipError extends Error {
  statusCode = 404;
  constructor(kind: string, id: string) {
    super(`${kind} not found`);
    this.name = 'ScopeOwnershipError';
    this.detail = { kind, id };
  }
  detail: { kind: string; id: string };
}

export interface ScopeInput {
  projectId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  taskId?: string | null;
}

/**
 * Verify that every scope id supplied by a client belongs to the authenticated
 * organization, then return the chain.
 *
 * Without this check a caller can pass another tenant's `agentId`/`taskId` in the
 * request body: `checkBudget` would answer with that tenant's budget names, hard
 * limits and utilization, and the resulting reservation would consume their
 * headroom and land in their rollups. Ids are cuids, but obscurity is not a
 * trust boundary.
 *
 * Throws `ScopeOwnershipError` (404, so it does not confirm existence in another
 * tenant) on the first id that does not resolve inside the org.
 */
export async function assertScopeOwnership(
  organizationId: string,
  scope: ScopeInput | undefined
): Promise<ScopeChain> {
  const chain: ScopeChain = { organizationId };
  if (!scope) return chain;

  if (scope.projectId) {
    const hit = await prisma.project.findFirst({
      where: { id: scope.projectId, organizationId },
      select: { id: true },
    });
    if (!hit) throw new ScopeOwnershipError('project', scope.projectId);
    chain.projectId = hit.id;
  }

  if (scope.userId) {
    const hit = await prisma.user.findFirst({
      where: { id: scope.userId, organizationId },
      select: { id: true },
    });
    if (!hit) throw new ScopeOwnershipError('user', scope.userId);
    chain.userId = hit.id;
  }

  if (scope.agentId) {
    const hit = await prisma.agent.findFirst({
      where: { id: scope.agentId, project: { organizationId } },
      select: { id: true },
    });
    if (!hit) throw new ScopeOwnershipError('agent', scope.agentId);
    chain.agentId = hit.id;
  }

  if (scope.sessionId) {
    const hit = await prisma.session.findFirst({
      where: { id: scope.sessionId, agent: { project: { organizationId } } },
      select: { id: true },
    });
    if (!hit) throw new ScopeOwnershipError('session', scope.sessionId);
    chain.sessionId = hit.id;
  }

  if (scope.taskId) {
    const hit = await prisma.task.findFirst({
      where: { id: scope.taskId, session: { agent: { project: { organizationId } } } },
      select: { id: true },
    });
    if (!hit) throw new ScopeOwnershipError('task', scope.taskId);
    chain.taskId = hit.id;
  }

  return chain;
}
