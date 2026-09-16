import { prisma } from '../db.js';
import { config } from '../config.js';
import type { ScopeChain } from '../types.js';

export const ASSISTANT_PROJECT = 'TBM Assistant';
export const ASSISTANT_AGENT = 'tbm-assistant';
export const ASSISTANT_BUDGET = 'Assistant monthly tokens';

/**
 * The assistant is a first-class agent inside the tenant it serves, not a
 * privileged side channel. It gets its own project, agent and default budget so
 * its spend shows up in exactly the same rollups, budgets and policies as any
 * customer agent — and so a tenant can cap or pause it like any other.
 */
export async function ensureAssistantIdentity(organizationId: string): Promise<{
  chain: ScopeChain;
  agentId: string;
  budgetId: string;
  paused: boolean;
}> {
  const project =
    (await prisma.project.findFirst({ where: { organizationId, name: ASSISTANT_PROJECT } })) ??
    (await prisma.project.create({ data: { organizationId, name: ASSISTANT_PROJECT } }));

  const agent =
    (await prisma.agent.findFirst({ where: { projectId: project.id, name: ASSISTANT_AGENT } })) ??
    (await prisma.agent.create({ data: { projectId: project.id, name: ASSISTANT_AGENT } }));

  const budget =
    (await prisma.budget.findFirst({
      where: { organizationId, level: 'AGENT', scopeId: agent.id, name: ASSISTANT_BUDGET },
    })) ??
    (await prisma.budget.create({
      data: {
        organizationId,
        name: ASSISTANT_BUDGET,
        level: 'AGENT',
        scopeId: agent.id,
        metric: 'TOKENS',
        hardLimit: config.assistantBudgetTokens,
        softLimit: Math.floor(config.assistantBudgetTokens * 0.8),
        warningThreshold: 0.8,
        resetPeriod: 'MONTHLY',
        priority: 5,
        fallbackBehavior: 'BLOCK',
      },
    }));

  return {
    chain: { organizationId, projectId: project.id, agentId: agent.id },
    agentId: agent.id,
    budgetId: budget.id,
    paused: agent.status === 'paused',
  };
}

/** Per-conversation session/task so each chat is its own accounting unit. */
export async function ensureConversationScope(
  organizationId: string,
  conversationId: string
): Promise<ScopeChain> {
  const identity = await ensureAssistantIdentity(organizationId);
  const session =
    (await prisma.session.findFirst({ where: { agentId: identity.agentId, label: conversationId } })) ??
    (await prisma.session.create({ data: { agentId: identity.agentId, label: conversationId } }));
  const task =
    (await prisma.task.findFirst({ where: { sessionId: session.id, name: 'assistant-chat' } })) ??
    (await prisma.task.create({ data: { sessionId: session.id, name: 'assistant-chat' } }));
  return { ...identity.chain, sessionId: session.id, taskId: task.id };
}
