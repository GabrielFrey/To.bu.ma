import type { FastifyRequest } from 'fastify';
import { actorFromAuth } from '../services/audit.js';

/** Authenticated organization id. Every /v1 route runs behind `authenticate`. */
export function orgId(req: FastifyRequest): string {
  return req.auth!.organizationId;
}

/** Stable audit actor for the authenticated caller. */
export function actor(req: FastifyRequest): string {
  return actorFromAuth(req.auth);
}
