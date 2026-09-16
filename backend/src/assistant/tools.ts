import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import * as analytics from '../services/analytics.js';
import { chargebackReport, exportChargebackCsv } from '../services/chargeback.js';
import { emitEvent } from '../services/events.js';
import { getBuiltinPack, importPolicyPack, listBuiltinPacks } from '../services/policyPacks.js';
import { simulatePolicies } from '../services/policySimulation.js';
import { forecastRun } from '../services/runForecast.js';
import { computeSavingsLedger, costPerResolvedTask } from '../services/savingsLedger.js';
import { resolveApproval } from '../routes/approvals.js';
import type { ToolSpec } from '../providers/types.js';

/**
 * Risk classes:
 *  - `read`        — no state change. Executes immediately.
 *  - `write`       — changes state in a bounded, spend-reducing or additive way
 *                    (create a budget, add a policy, pause an agent). Executes
 *                    immediately; every call is audited.
 *  - `destructive` — removes a guardrail, raises a limit, releases spend, or
 *                    changes many objects at once. Requires a confirm-token
 *                    round-trip before it runs.
 *
 * Some tools are *conditionally* destructive: `update_budget` is a write when it
 * tightens a limit and destructive when it raises one or deactivates a budget;
 * `approve_request` is destructive above a configurable dollar threshold. That is
 * what `classify` is for — the risk class is a function of the arguments, not
 * just the tool name.
 */
export type Risk = 'read' | 'write' | 'destructive';

export interface ToolContext {
  organizationId: string;
  /** Audit actor, e.g. `assistant:<conversationId>` for the tool call itself. */
  actor: string;
  conversationId: string;
}

export interface ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  /** Base risk class. `classify` may escalate it based on arguments. */
  risk: Risk;
  /** Escalate/justify per-call. Returning a reason marks the call as gated. */
  classify?: (
    args: z.infer<S>,
    ctx: ToolContext
  ) => Promise<{ risk: Risk; reason?: string }> | { risk: Risk; reason?: string };
  /** One-line human summary shown in the UI and the confirmation prompt. */
  summarize?: (args: z.infer<S>) => string;
  handler: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}

export class ToolInputError extends Error {}

/** Resolve a budget by id or (case-insensitive) name inside the tenant. */
async function findBudget(organizationId: string, ref: { id?: string; name?: string }) {
  if (ref.id) {
    const byId = await prisma.budget.findFirst({ where: { id: ref.id, organizationId } });
    if (byId) return byId;
  }
  if (ref.name) {
    const all = await prisma.budget.findMany({ where: { organizationId } });
    const needle = ref.name.trim().toLowerCase();
    return (
      all.find((b) => b.name.toLowerCase() === needle) ??
      all.find((b) => b.name.toLowerCase().includes(needle)) ??
      null
    );
  }
  return null;
}

async function findAgent(organizationId: string, ref: { id?: string; name?: string }) {
  if (ref.id) {
    const byId = await prisma.agent.findFirst({
      where: { id: ref.id, project: { organizationId } },
    });
    if (byId) return byId;
  }
  if (ref.name) {
    const all = await prisma.agent.findMany({ where: { project: { organizationId } } });
    const needle = ref.name.trim().toLowerCase();
    return (
      all.find((a) => a.name.toLowerCase() === needle) ??
      all.find((a) => a.name.toLowerCase().includes(needle)) ??
      null
    );
  }
  return null;
}

/**
 * How the model names a budget. `name` is accepted as an alias of `budgetName`
 * because that is what models (and users) reach for; tools whose own `name`
 * argument means something else use `budgetName` only.
 */
const budgetRef = z.object({
  budgetId: z.string().optional(),
  budgetName: z.string().optional(),
  name: z.string().optional(),
});

function budgetRefOf(args: { budgetId?: string; budgetName?: string; name?: string }) {
  return { id: args.budgetId, name: args.budgetName ?? args.name };
}

const agentRef = z.object({
  agentId: z.string().optional(),
  name: z.string().optional(),
});

const empty = z.object({}).passthrough();

function money(n: number): string {
  return `$${n.toFixed(n < 0.01 ? 6 : 2)}`;
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

const readTools: ToolDefinition[] = [
  {
    name: 'get_spend_summary',
    description:
      'Total tokens, cost in USD and request count for the whole organization. Use for "how much have we spent".',
    schema: empty,
    risk: 'read',
    summarize: () => 'organization-wide spend total',
    handler: (_a, ctx) => analytics.totalSpend(ctx.organizationId),
  },
  {
    name: 'get_spend_by_agent',
    description: 'Spend broken down per agent, highest first. Use for "which agent costs the most".',
    schema: empty,
    risk: 'read',
    summarize: () => 'spend grouped by agent',
    handler: (_a, ctx) => analytics.spendByAgent(ctx.organizationId),
  },
  {
    name: 'get_spend_by_task',
    description: 'Spend broken down per task. Use for per-ticket / per-job unit economics.',
    schema: empty,
    risk: 'read',
    summarize: () => 'spend grouped by task',
    handler: (_a, ctx) => analytics.spendByTask(ctx.organizationId),
  },
  {
    name: 'get_cost_per_task',
    description: 'Average cost per completed task — the agent-economics KPI.',
    schema: empty,
    risk: 'read',
    summarize: () => 'cost per resolved task',
    handler: (_a, ctx) => costPerResolvedTask(ctx.organizationId),
  },
  {
    name: 'list_budgets',
    description:
      'Every budget in the organization with its level, metric, hard limit, current utilization and fallback behavior.',
    schema: empty,
    risk: 'read',
    summarize: () => 'all budgets with utilization',
    handler: (_a, ctx) => analytics.activeBudgets(ctx.organizationId),
  },
  {
    name: 'list_policies',
    description: 'Every policy attached to a budget: its condition, action and priority.',
    schema: z.object({ budgetId: z.string().optional() }),
    risk: 'read',
    summarize: (a) => (a.budgetId ? `policies on budget ${a.budgetId}` : 'all policies'),
    handler: (args, ctx) =>
      prisma.budgetPolicy.findMany({
        where: {
          budget: { organizationId: ctx.organizationId },
          ...(args.budgetId ? { budgetId: args.budgetId } : {}),
        },
        orderBy: { priority: 'desc' },
      }),
  },
  {
    name: 'get_savings_ledger',
    description:
      'Counterfactual savings: what enforcement and optimization avoided spending. Estimates, not invoices.',
    schema: empty,
    risk: 'read',
    summarize: () => 'savings ledger',
    handler: (_a, ctx) => computeSavingsLedger(ctx.organizationId),
  },
  {
    name: 'list_blocked_requests',
    description: 'Recent requests that were blocked, held for approval or rate-limited, with the reason.',
    schema: empty,
    risk: 'read',
    summarize: () => 'recently blocked requests',
    handler: (_a, ctx) => analytics.blockedRequests(ctx.organizationId),
  },
  {
    name: 'list_warnings',
    description: 'Recent warning / degrade / compress policy events.',
    schema: empty,
    risk: 'read',
    summarize: () => 'recent warnings',
    handler: (_a, ctx) => analytics.warnings(ctx.organizationId),
  },
  {
    name: 'list_loops',
    description: 'Sessions where the same prompt repeated above the loop threshold — wasted spend.',
    schema: empty,
    risk: 'read',
    summarize: () => 'detected agent loops',
    handler: (_a, ctx) => analytics.inefficientLoops(ctx.organizationId),
  },
  {
    name: 'list_agents',
    description: 'Agents in the organization with their paused/active status. Use to resolve an agent name to an id.',
    schema: empty,
    risk: 'read',
    summarize: () => 'agent directory',
    handler: (_a, ctx) =>
      prisma.agent.findMany({
        where: { project: { organizationId: ctx.organizationId } },
        select: { id: true, name: true, status: true, projectId: true },
      }),
  },
  {
    name: 'list_pending_approvals',
    description: 'Approval requests still waiting for a human decision.',
    schema: empty,
    risk: 'read',
    summarize: () => 'pending approvals',
    handler: (_a, ctx) =>
      prisma.approval.findMany({
        where: { organizationId: ctx.organizationId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      }),
  },
  {
    name: 'get_recommendations',
    description: 'Heuristic optimization recommendations (loops, retries, caching, model routing).',
    schema: empty,
    risk: 'read',
    summarize: () => 'optimization recommendations',
    handler: (_a, ctx) => analytics.recommendations(ctx.organizationId),
  },
  {
    name: 'list_policy_packs',
    description: 'Built-in portable policy packs available to import.',
    schema: empty,
    risk: 'read',
    summarize: () => 'available policy packs',
    handler: async () => listBuiltinPacks(),
  },
  {
    name: 'forecast_run',
    description:
      'Predict whether a multi-step agent run fits the applicable budgets before it starts. Returns steps until the limit and a recommendation.',
    schema: z.object({
      estimatedSteps: z.number().int().positive().max(10_000),
      avgPromptTokens: z.number().int().min(0).default(600),
      avgCompletionTokens: z.number().int().min(0).default(200),
      toolCallsPerStep: z.number().int().min(0).optional(),
      avgToolTokens: z.number().int().min(0).optional(),
      model: z.string().optional(),
      agentName: z.string().optional(),
    }),
    risk: 'read',
    summarize: (a) => `forecast ${a.estimatedSteps} steps`,
    handler: async (args, ctx) => {
      const agent = args.agentName ? await findAgent(ctx.organizationId, { name: args.agentName }) : null;
      return forecastRun({
        chain: { organizationId: ctx.organizationId, agentId: agent?.id },
        model: args.model ?? config.assistantModel,
        estimatedSteps: args.estimatedSteps,
        avgPromptTokens: args.avgPromptTokens,
        avgCompletionTokens: args.avgCompletionTokens,
        toolCallsPerStep: args.toolCallsPerStep,
        avgToolTokens: args.avgToolTokens,
      });
    },
  },
  {
    name: 'simulate_policies',
    description:
      'Dry-run a hypothetical policy against historical traffic. Persists nothing; reports how many requests would change.',
    schema: z.object({
      name: z.string().default('simulated policy'),
      condition: z.string(),
      action: z.enum([
        'ALLOW',
        'WARN',
        'DEGRADE',
        'COMPRESS',
        'SUMMARIZE',
        'TRUNCATE',
        'REQUIRE_APPROVAL',
        'STOP_AGENT',
        'RETRY_LIMIT',
        'TOOL_LIMIT',
      ]),
      lookbackHours: z.number().int().positive().max(8760).optional(),
    }),
    risk: 'read',
    summarize: (a) => `simulate "${a.condition}" → ${a.action}`,
    handler: (args, ctx) =>
      simulatePolicies({
        organizationId: ctx.organizationId,
        hypotheticalPolicies: [{ name: args.name, condition: args.condition, action: args.action }],
        lookbackHours: args.lookbackHours,
      }),
  },
  {
    name: 'export_chargeback_csv',
    description:
      'Produce the finance chargeback report grouped by agent, task, project or user. Returns the rows plus the CSV text.',
    schema: z.object({
      groupBy: z.enum(['agent', 'task', 'project', 'user']).default('agent'),
    }),
    risk: 'read',
    summarize: (a) => `chargeback CSV by ${a.groupBy}`,
    handler: async (args, ctx) => {
      const { csv, filename, rows } = await exportChargebackCsv(ctx.organizationId, args.groupBy);
      return { filename, rowCount: rows.length, totalCostUsd: rows.reduce((s, r) => s + r.costUsd, 0), csv };
    },
  },
  {
    name: 'get_chargeback_report',
    description: 'Chargeback rows (no CSV) grouped by a dimension.',
    schema: z.object({ groupBy: z.enum(['agent', 'task', 'project', 'user']).default('agent') }),
    risk: 'read',
    summarize: (a) => `chargeback rows by ${a.groupBy}`,
    handler: (args, ctx) => chargebackReport(ctx.organizationId, args.groupBy),
  },
];

// ---------------------------------------------------------------------------
// Write tools (execute directly, always audited)
// ---------------------------------------------------------------------------

const writeTools: ToolDefinition[] = [
  {
    name: 'create_budget',
    description:
      'Create a budget. Adding a budget only ever constrains spend, so it runs without confirmation.',
    schema: z.object({
      name: z.string().min(1).max(120),
      level: z.enum(['ORGANIZATION', 'PROJECT', 'USER', 'AGENT', 'SESSION', 'TASK', 'TOOL_CALL', 'REQUEST']),
      metric: z.enum(['TOKENS', 'COST_USD']).default('TOKENS'),
      hardLimit: z.number().positive(),
      softLimit: z.number().positive().optional(),
      warningThreshold: z.number().min(0).max(1).default(0.8),
      resetPeriod: z.enum(['NEVER', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']).default('MONTHLY'),
      fallbackBehavior: z
        .enum(['BLOCK', 'DEGRADE', 'SUMMARIZE', 'REQUIRE_APPROVAL', 'STOP_AGENT'])
        .default('BLOCK'),
      agentName: z.string().optional(),
    }),
    risk: 'write',
    summarize: (a) => `create ${a.level} budget "${a.name}" at ${a.hardLimit} ${a.metric}`,
    handler: async (args, ctx) => {
      let scopeId: string | null = null;
      if (args.level === 'AGENT') {
        if (!args.agentName) throw new ToolInputError('an AGENT budget needs agentName');
        const agent = await findAgent(ctx.organizationId, { name: args.agentName });
        if (!agent) throw new ToolInputError(`no agent named "${args.agentName}"`);
        scopeId = agent.id;
      }
      return prisma.budget.create({
        data: {
          organizationId: ctx.organizationId,
          name: args.name,
          level: args.level,
          scopeId,
          metric: args.metric,
          hardLimit: args.hardLimit,
          softLimit: args.softLimit ?? null,
          warningThreshold: args.warningThreshold,
          resetPeriod: args.resetPeriod,
          fallbackBehavior: args.fallbackBehavior,
        },
      });
    },
  },
  {
    name: 'create_policy',
    description:
      'Attach a policy to a budget, e.g. condition "utilization>=0.8" with action WARN, or "loop" with STOP_AGENT.',
    schema: z.object({
      budgetId: z.string().optional(),
      budgetName: z.string().optional(),
      name: z.string().min(1).max(120),
      condition: z.string().min(1).max(200),
      action: z.enum([
        'ALLOW',
        'WARN',
        'DEGRADE',
        'COMPRESS',
        'SUMMARIZE',
        'TRUNCATE',
        'REQUIRE_APPROVAL',
        'STOP_AGENT',
        'RETRY_LIMIT',
        'TOOL_LIMIT',
      ]),
      priority: z.number().int().min(0).max(10).default(5),
    }),
    risk: 'write',
    classify: (args) =>
      // An ALLOW policy relaxes enforcement rather than adding to it.
      args.action === 'ALLOW'
        ? { risk: 'destructive', reason: 'an ALLOW policy weakens enforcement on this budget' }
        : { risk: 'write' },
    summarize: (a) => `policy "${a.name}": ${a.condition} → ${a.action}`,
    handler: async (args, ctx) => {
      // Fall back to the highest-priority budget when the model does not name one,
      // which is the usual intent for an org-wide guardrail.
      const target =
        (await findBudget(ctx.organizationId, { id: args.budgetId, name: args.budgetName })) ??
        (await prisma.budget.findFirst({
          where: { organizationId: ctx.organizationId, active: true },
          orderBy: { priority: 'desc' },
        }));
      if (!target) throw new ToolInputError('no budget to attach this policy to — create a budget first');
      return prisma.budgetPolicy.create({
        data: {
          budgetId: target.id,
          name: args.name,
          condition: args.condition,
          action: args.action,
          priority: args.priority,
        },
      });
    },
  },
  {
    name: 'pause_agent',
    description: 'Pause an agent so every further LLM call from it is blocked. Stops spend immediately.',
    schema: agentRef,
    risk: 'write',
    summarize: (a) => `pause agent ${a.name ?? a.agentId}`,
    handler: async (args, ctx) => {
      const agent = await findAgent(ctx.organizationId, { id: args.agentId, name: args.name });
      if (!agent) throw new ToolInputError(`no agent matching ${args.name ?? args.agentId ?? '(nothing)'}`);
      const updated = await prisma.agent.update({ where: { id: agent.id }, data: { status: 'paused' } });
      await emitEvent({
        organizationId: ctx.organizationId,
        type: 'agent_paused',
        data: { agentId: agent.id, agentName: agent.name, via: 'assistant' },
      }).catch(() => {});
      return { id: updated.id, name: updated.name, status: updated.status };
    },
  },
];

// ---------------------------------------------------------------------------
// Destructive tools (confirm-token round trip required)
// ---------------------------------------------------------------------------

const destructiveTools: ToolDefinition[] = [
  {
    name: 'update_budget',
    description:
      'Change a budget. Lowering a limit applies immediately; raising a hard limit or deactivating a budget needs confirmation.',
    schema: budgetRef.extend({
      hardLimit: z.number().positive().optional(),
      softLimit: z.number().positive().optional(),
      warningThreshold: z.number().min(0).max(1).optional(),
      resetPeriod: z.enum(['NEVER', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']).optional(),
      fallbackBehavior: z
        .enum(['BLOCK', 'DEGRADE', 'SUMMARIZE', 'REQUIRE_APPROVAL', 'STOP_AGENT'])
        .optional(),
      active: z.boolean().optional(),
    }),
    risk: 'write',
    classify: async (args, ctx) => {
      const budget = await findBudget(ctx.organizationId, budgetRefOf(args));
      if (!budget) return { risk: 'write' }; // handler will fail loudly with a clear message
      if (args.active === false) {
        return { risk: 'destructive', reason: `deactivating "${budget.name}" removes the guardrail entirely` };
      }
      if (args.hardLimit != null && args.hardLimit > budget.hardLimit) {
        const pct = Math.round(((args.hardLimit - budget.hardLimit) / budget.hardLimit) * 100);
        return {
          risk: 'destructive',
          reason: `raises the hard limit on "${budget.name}" from ${budget.hardLimit} to ${args.hardLimit} (+${pct}%)`,
        };
      }
      return { risk: 'write' };
    },
    summarize: (a) =>
      `update budget ${a.budgetName ?? a.name ?? a.budgetId}` +
      (a.hardLimit != null ? ` hardLimit→${a.hardLimit}` : '') +
      (a.active === false ? ' (deactivate)' : ''),
    handler: async (args, ctx) => {
      const ref = budgetRefOf(args);
      const budget = await findBudget(ctx.organizationId, ref);
      if (!budget) throw new ToolInputError(`no budget matching ${ref.name ?? ref.id ?? '(nothing)'}`);
      const { budgetId: _b, budgetName: _bn, name: _n, ...changes } = args;
      if (Object.keys(changes).length === 0) throw new ToolInputError('nothing to change');
      const updated = await prisma.budget.update({ where: { id: budget.id }, data: changes });
      return { before: { hardLimit: budget.hardLimit, active: budget.active }, after: updated };
    },
  },
  {
    name: 'delete_budget',
    description: 'Delete a budget and its policies. Removes a spend guardrail, so it always needs confirmation.',
    schema: budgetRef,
    risk: 'destructive',
    classify: async (args, ctx) => {
      const budget = await findBudget(ctx.organizationId, budgetRefOf(args));
      return {
        risk: 'destructive',
        reason: budget
          ? `permanently deletes budget "${budget.name}" (${budget.level}, limit ${budget.hardLimit}) and its policies`
          : 'permanently deletes a budget and its policies',
      };
    },
    summarize: (a) => `delete budget ${a.budgetName ?? a.name ?? a.budgetId}`,
    handler: async (args, ctx) => {
      const ref = budgetRefOf(args);
      const budget = await findBudget(ctx.organizationId, ref);
      if (!budget) throw new ToolInputError(`no budget matching ${ref.name ?? ref.id ?? '(nothing)'}`);
      const policies = await prisma.budgetPolicy.deleteMany({ where: { budgetId: budget.id } });
      await prisma.policyEvent.updateMany({ where: { budgetId: budget.id }, data: { budgetId: null } });
      await prisma.budget.delete({ where: { id: budget.id } });
      return { deleted: budget.name, level: budget.level, policiesDeleted: policies.count };
    },
  },
  {
    name: 'resume_agent',
    description:
      'Un-pause an agent so it can spend again. Needs confirmation because a human paused it deliberately.',
    schema: agentRef,
    risk: 'destructive',
    classify: async (args, ctx) => {
      const agent = await findAgent(ctx.organizationId, { id: args.agentId, name: args.name });
      return {
        risk: 'destructive',
        reason: `re-enables LLM spend for agent "${agent?.name ?? args.name ?? args.agentId}"`,
      };
    },
    summarize: (a) => `resume agent ${a.name ?? a.agentId}`,
    handler: async (args, ctx) => {
      const agent = await findAgent(ctx.organizationId, { id: args.agentId, name: args.name });
      if (!agent) throw new ToolInputError(`no agent matching ${args.name ?? args.agentId ?? '(nothing)'}`);
      const updated = await prisma.agent.update({ where: { id: agent.id }, data: { status: 'active' } });
      await emitEvent({
        organizationId: ctx.organizationId,
        type: 'agent_resumed',
        data: { agentId: agent.id, agentName: agent.name, via: 'assistant' },
      }).catch(() => {});
      return { id: updated.id, name: updated.name, status: updated.status };
    },
  },
  {
    name: 'approve_request',
    description:
      'Approve or deny a held request. Approving releases real spend, so anything above the configured dollar threshold needs confirmation.',
    schema: z.object({
      approvalId: z.string(),
      decision: z.enum(['approve', 'deny']).default('approve'),
    }),
    risk: 'write',
    classify: async (args, ctx) => {
      if (args.decision === 'deny') return { risk: 'write' }; // denying only prevents spend
      const approval = await prisma.approval.findFirst({
        where: { id: args.approvalId, organizationId: ctx.organizationId },
      });
      if (!approval) return { risk: 'write' };
      const request = await prisma.llmRequest.findFirst({ where: { id: approval.requestId } });
      const cost = request?.estimatedCostUsd ?? 0;
      if (cost >= config.assistantApprovalUsdLimit) {
        return {
          risk: 'destructive',
          reason: `approves an estimated ${money(cost)} of spend, at or above the ${money(
            config.assistantApprovalUsdLimit
          )} confirmation threshold`,
        };
      }
      return { risk: 'write' };
    },
    summarize: (a) => `${a.decision} approval ${a.approvalId}`,
    handler: async (args, ctx) => {
      const result = await resolveApproval({
        approvalId: args.approvalId,
        organizationId: ctx.organizationId,
        action: args.decision,
        actor: ctx.actor,
        via: 'assistant',
      });
      if (!result.ok) throw new ToolInputError(`approval ${args.approvalId}: ${result.reason}`);
      return result.approval;
    },
  },
  {
    name: 'import_policy_pack',
    description:
      'Import a portable policy pack, creating several budgets and policies at once. Bulk change, so it needs confirmation.',
    schema: z.object({
      packId: z.string(),
      agentName: z.string().optional(),
      taskName: z.string().optional(),
    }),
    risk: 'destructive',
    classify: (args) => {
      const pack = getBuiltinPack(args.packId);
      return {
        risk: 'destructive',
        reason: pack
          ? `creates ${pack.budgets.length} budget(s) and ${pack.policies.length} policy(ies) from pack "${pack.name}"`
          : `imports policy pack "${args.packId}" in bulk`,
      };
    },
    summarize: (a) => `import policy pack ${a.packId}`,
    handler: async (args, ctx) => {
      const pack = getBuiltinPack(args.packId);
      if (!pack) {
        throw new ToolInputError(
          `unknown pack "${args.packId}". Available: ${listBuiltinPacks().map((p) => p.id).join(', ')}`
        );
      }
      const agent = args.agentName ? await findAgent(ctx.organizationId, { name: args.agentName }) : null;
      const result = await importPolicyPack({
        organizationId: ctx.organizationId,
        pack,
        scopeBindings: agent ? { agentId: agent.id } : undefined,
      });
      return { packName: pack.name, ...result };
    },
  },
];

export const TOOLS: ToolDefinition[] = [...readTools, ...writeTools, ...destructiveTools];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

export function toolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

/** Tools that always require confirmation regardless of arguments. */
export function alwaysGatedTools(): string[] {
  return TOOLS.filter((t) => t.risk === 'destructive').map((t) => t.name);
}

/** Tools whose risk depends on the arguments. */
export function conditionallyGatedTools(): string[] {
  return TOOLS.filter((t) => t.risk !== 'destructive' && t.classify).map((t) => t.name);
}

/**
 * Decide the effective risk of one concrete call. `destructive` means the runner
 * must not execute it until a valid confirmation token comes back.
 */
export async function classifyCall(
  tool: ToolDefinition,
  args: unknown,
  ctx: ToolContext
): Promise<{ risk: Risk; reason?: string }> {
  if (!tool.classify) return { risk: tool.risk };
  const verdict = await tool.classify(args as never, ctx);
  // A classifier may escalate but never de-escalate a declared destructive tool.
  if (tool.risk === 'destructive' && verdict.risk !== 'destructive') {
    return { risk: 'destructive', reason: verdict.reason };
  }
  return verdict;
}

export function requiresConfirmation(risk: Risk): boolean {
  return risk === 'destructive';
}

/** Convert the registry into the provider-facing JSON-schema tool list. */
export function toolSpecs(): ToolSpec[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: zodToJsonSchema(t.schema),
  }));
}

/**
 * Minimal Zod → JSON-schema conversion covering the shapes this registry uses
 * (objects of strings/numbers/booleans/enums, with optionals and defaults).
 * A dependency for this would be ~40 kB to describe 25 flat argument objects.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def as { typeName?: string };
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value as z.ZodTypeAny);
        if (!isOptional(value as z.ZodTypeAny)) required.push(key);
      }
      return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
    }
    case 'ZodOptional':
    case 'ZodNullable':
      return zodToJsonSchema((schema as z.ZodOptional<z.ZodTypeAny>).unwrap());
    case 'ZodDefault': {
      const inner = (schema._def as { innerType: z.ZodTypeAny }).innerType;
      const defaultValue = (schema._def as { defaultValue: () => unknown }).defaultValue();
      return { ...zodToJsonSchema(inner), default: defaultValue as never };
    }
    case 'ZodEnum':
      return { type: 'string', enum: (schema._def as { values: string[] }).values };
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodArray':
      return { type: 'array', items: zodToJsonSchema((schema._def as { type: z.ZodTypeAny }).type) };
    default:
      return { type: 'object' };
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const name = (schema._def as { typeName?: string }).typeName;
  return name === 'ZodOptional' || name === 'ZodDefault' || name === 'ZodNullable';
}
