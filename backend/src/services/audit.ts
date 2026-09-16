import { prisma } from '../db.js';

/**
 * Append-only record of who changed what. Every state-changing action that a
 * human or the in-product assistant can trigger writes one row, so "who raised
 * this hard limit?" and "what did the assistant do on my tenant?" are answerable
 * questions.
 *
 * Best-effort by design: an audit write must never fail the operation it
 * describes, so failures are swallowed after being logged.
 */
export interface AuditEntry {
  organizationId: string;
  /** Who acted, e.g. `apikey:<id>`, `assistant:<conversationId>`, `link:approval`. */
  actor: string;
  /** Dotted action name, e.g. `budget.update`, `assistant.tool.create_budget`. */
  action: string;
  /** The thing acted on, e.g. a budget id. */
  target?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actor: entry.actor,
        action: entry.action,
        target: entry.target ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      },
    });
  } catch (err) {
    console.error('audit write failed', { action: entry.action, error: (err as Error).message });
  }
}

export interface AuditActor {
  organizationId: string;
  apiKeyId?: string;
  role?: string;
}

/** Stable actor string for an authenticated API caller. */
export function actorFromAuth(auth: AuditActor | undefined): string {
  if (!auth?.apiKeyId) return 'unknown';
  return `apikey:${auth.apiKeyId}`;
}

export async function listAuditLog(organizationId: string, take = 100) {
  return prisma.auditLog.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}
