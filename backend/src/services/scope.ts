import { prisma } from '../db.js';
import type { ScopeChain } from '../types.js';

/**
 * Resolve a scope chain from proxy headers. Header values are treated as human
 * names and resolved find-or-create within the org, so any business process can
 * simply set `X-TBM-Agent: invoice-processor` (no pre-provisioning of IDs).
 *
 * Defaults when headers are absent:
 *  - No project header + an agent header  -> a default project named "proxy".
 *  - No agent header                      -> the request is attributed at org
 *    level only (org-level budgets still apply; no agent/session/task rollup).
 *  - Session/task require their parent; missing parents are created as
 *    "proxy" / "proxy-agent" so nested scopes always resolve.
 */
export interface ProxyScopeHeaders {
  project?: string;
  agent?: string;
  session?: string;
  task?: string;
  user?: string;
}

const DEFAULT_PROJECT = 'proxy';
const DEFAULT_AGENT = 'proxy-agent';

async function ensureProject(organizationId: string, name: string) {
  const existing = await prisma.project.findFirst({ where: { organizationId, name } });
  return existing ?? prisma.project.create({ data: { organizationId, name } });
}

async function ensureAgent(projectId: string, name: string) {
  const existing = await prisma.agent.findFirst({ where: { projectId, name } });
  return existing ?? prisma.agent.create({ data: { projectId, name } });
}

async function ensureSession(agentId: string, label: string) {
  const existing = await prisma.session.findFirst({ where: { agentId, label } });
  return existing ?? prisma.session.create({ data: { agentId, label } });
}

async function ensureTask(sessionId: string, name: string) {
  const existing = await prisma.task.findFirst({ where: { sessionId, name } });
  return existing ?? prisma.task.create({ data: { sessionId, name } });
}

export async function resolveScopeFromHeaders(
  organizationId: string,
  headers: ProxyScopeHeaders
): Promise<ScopeChain> {
  const chain: ScopeChain = { organizationId };

  const needsProject = !!(headers.project || headers.agent || headers.session || headers.task);
  if (!needsProject) return chain;

  const project = await ensureProject(organizationId, headers.project ?? DEFAULT_PROJECT);
  chain.projectId = project.id;

  const needsAgent = !!(headers.agent || headers.session || headers.task);
  if (!needsAgent) return chain;

  const agent = await ensureAgent(project.id, headers.agent ?? DEFAULT_AGENT);
  chain.agentId = agent.id;

  if (headers.session || headers.task) {
    const session = await ensureSession(agent.id, headers.session ?? 'proxy-session');
    chain.sessionId = session.id;
    if (headers.task) {
      const task = await ensureTask(session.id, headers.task);
      chain.taskId = task.id;
    }
  }

  return chain;
}

/** Extract the TBM scope headers (case-insensitive) from a raw headers map. */
export function readScopeHeaders(headers: Record<string, unknown>): ProxyScopeHeaders {
  const get = (k: string) => {
    const v = headers[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  return {
    project: get('x-tbm-project'),
    agent: get('x-tbm-agent'),
    session: get('x-tbm-session'),
    task: get('x-tbm-task'),
    user: get('x-tbm-user'),
  };
}
