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

/**
 * Proxy auth: OpenAI SDKs send the key as `Authorization: Bearer <key>`, so the
 * transparent proxy accepts the TBM key there (falling back to x-api-key). This
 * is what makes "just change base_url + api key" work with any OpenAI client.
 */
export async function authenticateProxy(req: FastifyRequest, reply: FastifyReply) {
  let token: string | undefined;
  const authz = req.headers['authorization'];
  if (typeof authz === 'string' && authz.toLowerCase().startsWith('bearer ')) {
    token = authz.slice(7).trim();
  }
  if (!token && typeof req.headers['x-api-key'] === 'string') {
    token = req.headers['x-api-key'] as string;
  }
  if (!token) {
    return reply.code(401).send({
      error: { message: 'Missing API key. Send it as Authorization: Bearer <tbm_key>.', type: 'invalid_request_error', code: 'missing_api_key' },
    });
  }
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(token) } });
  if (!key) {
    return reply.code(401).send({
      error: { message: 'Invalid API key.', type: 'invalid_request_error', code: 'invalid_api_key' },
    });
  }
  req.auth = { organizationId: key.organizationId, role: key.role, apiKeyId: key.id };
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
