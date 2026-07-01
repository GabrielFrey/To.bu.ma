import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './db.js';
import { hashApiKey } from './crypto.js';

export interface AuthContext {
  organizationId: string;
  role: string;
  apiKeyId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

const ROLE_RANK: Record<string, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** Fastify preHandler: resolve x-api-key → org scope. */
export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const token = req.headers['x-api-key'];
  if (!token || typeof token !== 'string') {
    return reply.code(401).send({ error: 'missing x-api-key' });
  }
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(token) } });
  if (!key) return reply.code(401).send({ error: 'invalid api key' });
  req.auth = { organizationId: key.organizationId, role: key.role, apiKeyId: key.id };
  // Best-effort last-used tracking (non-blocking).
  void prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
}

/** RBAC guard factory: require at least the given role. */
export function requireRole(minRole: 'viewer' | 'member' | 'admin' | 'owner') {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const role = req.auth?.role ?? 'viewer';
    if ((ROLE_RANK[role] ?? 0) < ROLE_RANK[minRole]) {
      return reply.code(403).send({ error: `requires role ${minRole}` });
    }
  };
}
