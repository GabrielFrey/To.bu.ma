import { prisma } from '../db.js';
import type { BudgetLevel, ScopeChain } from '../types.js';

export const POLICY_PACK_KIND = 'tbm-policy-pack' as const;

export interface PolicyPackBudget {
  name: string;
  level: BudgetLevel;
  metric: 'TOKENS' | 'COST_USD';
  hardLimit: number;
  softLimit?: number | null;
  warningThreshold?: number;
  resetPeriod?: 'NEVER' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  priority?: number;
  fallbackBehavior?: 'BLOCK' | 'DEGRADE' | 'SUMMARIZE' | 'REQUIRE_APPROVAL' | 'STOP_AGENT';
  /** Logical scope this budget binds to; resolved at import via `scopeBindings`. */
  scopeHint?: keyof ScopeChain;
}

export interface PolicyPackPolicy {
  budgetName: string;
  name: string;
  condition: string;
  action:
    | 'ALLOW'
    | 'WARN'
    | 'DEGRADE'
    | 'COMPRESS'
    | 'SUMMARIZE'
    | 'TRUNCATE'
    | 'REQUIRE_APPROVAL'
    | 'STOP_AGENT'
    | 'RETRY_LIMIT'
    | 'TOOL_LIMIT';
  params?: Record<string, unknown>;
  priority?: number;
}

export interface PolicyPack {
  kind: typeof POLICY_PACK_KIND;
  version: 1;
  id: string;
  name: string;
  description: string;
  process: string;
  budgets: PolicyPackBudget[];
  policies: PolicyPackPolicy[];
}

export type ScopeBindings = Partial<Record<keyof ScopeChain, string>>;

const POLICY_ACTIONS = new Set<PolicyPackPolicy['action']>([
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
]);

export const SUPPORT_DESK_PACK: PolicyPack = {
  kind: POLICY_PACK_KIND,
  version: 1,
  id: 'support-desk-pack',
  name: 'Support desk',
  description:
    'Daily agent cap, per-ticket task budget, loop stop, and degrade-before-block for helpdesk / CRM copilots.',
  process: 'support-desk',
  budgets: [
    {
      name: 'Support agent daily USD',
      level: 'AGENT',
      metric: 'COST_USD',
      hardLimit: 25,
      softLimit: 18,
      warningThreshold: 0.75,
      resetPeriod: 'DAILY',
      priority: 8,
      fallbackBehavior: 'DEGRADE',
      scopeHint: 'agentId',
    },
    {
      name: 'Per-ticket task tokens',
      level: 'TASK',
      metric: 'TOKENS',
      hardLimit: 8000,
      softLimit: 6000,
      warningThreshold: 0.8,
      resetPeriod: 'NEVER',
      priority: 6,
      fallbackBehavior: 'COMPRESS',
      scopeHint: 'taskId',
    },
  ],
  policies: [
    {
      budgetName: 'Support agent daily USD',
      name: 'Warn before daily cap',
      condition: 'utilization>=0.75',
      action: 'WARN',
      priority: 4,
    },
    {
      budgetName: 'Support agent daily USD',
      name: 'Degrade near daily cap',
      condition: 'utilization>=0.9',
      action: 'DEGRADE',
      priority: 7,
    },
    {
      budgetName: 'Per-ticket task tokens',
      name: 'Stop identical-prompt loops',
      condition: 'loop',
      action: 'STOP_AGENT',
      priority: 10,
    },
    {
      budgetName: 'Per-ticket task tokens',
      name: 'Cap retries on a ticket',
      condition: 'retries>=3',
      action: 'RETRY_LIMIT',
      priority: 9,
    },
    {
      budgetName: 'Per-ticket task tokens',
      name: 'Compress long ticket threads',
      condition: 'utilization>=0.7',
      action: 'COMPRESS',
      priority: 5,
    },
  ],
};

export const BATCH_ETL_PACK: PolicyPack = {
  kind: POLICY_PACK_KIND,
  version: 1,
  id: 'batch-etl-pack',
  name: 'Batch ETL',
  description:
    'Project-level daily spend guard for overnight classification / extraction jobs, with tool-call and retry limits.',
  process: 'batch-etl',
  budgets: [
    {
      name: 'ETL project daily USD',
      level: 'PROJECT',
      metric: 'COST_USD',
      hardLimit: 200,
      softLimit: 150,
      warningThreshold: 0.8,
      resetPeriod: 'DAILY',
      priority: 9,
      fallbackBehavior: 'BLOCK',
      scopeHint: 'projectId',
    },
    {
      name: 'ETL agent hourly tokens',
      level: 'AGENT',
      metric: 'TOKENS',
      hardLimit: 250_000,
      softLimit: 200_000,
      warningThreshold: 0.85,
      resetPeriod: 'HOURLY',
      priority: 7,
      fallbackBehavior: 'DEGRADE',
      scopeHint: 'agentId',
    },
  ],
  policies: [
    {
      budgetName: 'ETL project daily USD',
      name: 'Warn finance at 80%',
      condition: 'utilization>=0.8',
      action: 'WARN',
      priority: 3,
    },
    {
      budgetName: 'ETL agent hourly tokens',
      name: 'Degrade to cheaper model under load',
      condition: 'utilization>=0.85',
      action: 'DEGRADE',
      priority: 6,
    },
    {
      budgetName: 'ETL agent hourly tokens',
      name: 'Stop runaway tool spirals',
      condition: 'toolCalls>=40',
      action: 'TOOL_LIMIT',
      priority: 10,
    },
    {
      budgetName: 'ETL agent hourly tokens',
      name: 'Stop identical-row loops',
      condition: 'loop',
      action: 'STOP_AGENT',
      priority: 10,
    },
    {
      budgetName: 'ETL project daily USD',
      name: 'Require approval for expensive single calls',
      condition: 'requestCost>=1.5',
      action: 'REQUIRE_APPROVAL',
      priority: 8,
    },
  ],
};

export const BUILTIN_PACKS: PolicyPack[] = [SUPPORT_DESK_PACK, BATCH_ETL_PACK];

export function listBuiltinPacks(): Array<Pick<PolicyPack, 'id' | 'name' | 'description' | 'process'>> {
  return BUILTIN_PACKS.map(({ id, name, description, process }) => ({ id, name, description, process }));
}

export function getBuiltinPack(id: string): PolicyPack | undefined {
  return BUILTIN_PACKS.find((p) => p.id === id);
}

export function parsePolicyPack(input: unknown): PolicyPack {
  if (!input || typeof input !== 'object') throw new Error('policy pack must be an object');
  const p = input as Record<string, unknown>;
  if (p.kind !== POLICY_PACK_KIND) throw new Error(`expected kind "${POLICY_PACK_KIND}"`);
  if (p.version !== 1) throw new Error('unsupported policy pack version');
  if (typeof p.id !== 'string' || typeof p.name !== 'string') throw new Error('id and name required');
  if (!Array.isArray(p.budgets) || !Array.isArray(p.policies)) throw new Error('budgets and policies arrays required');
  const budgets = p.budgets as PolicyPackBudget[];
  const policies = p.policies as PolicyPackPolicy[];
  for (const b of budgets) {
    if (!b?.name || !b.level || !b.metric || typeof b.hardLimit !== 'number') {
      throw new Error('each budget needs name, level, metric, hardLimit');
    }
  }
  for (const pol of policies) {
    if (!pol?.budgetName || !pol.name || !pol.condition || !POLICY_ACTIONS.has(pol.action)) {
      throw new Error('each policy needs budgetName, name, condition, and a valid action');
    }
  }
  return {
    kind: POLICY_PACK_KIND,
    version: 1,
    id: p.id,
    name: p.name,
    description: typeof p.description === 'string' ? p.description : '',
    process: typeof p.process === 'string' ? p.process : 'custom',
    budgets,
    policies,
  };
}

function resolveScopeId(budget: PolicyPackBudget, bindings?: ScopeBindings): string | null {
  if (!budget.scopeHint) return null;
  const bound = bindings?.[budget.scopeHint];
  return bound ?? null;
}

export async function exportPolicyPack(organizationId: string, packId = 'exported-org-pack'): Promise<PolicyPack> {
  const budgets = await prisma.budget.findMany({
    where: { organizationId, active: true },
    include: { policies: { where: { active: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const packBudgets: PolicyPackBudget[] = budgets.map((b) => ({
    name: b.name,
    level: b.level as BudgetLevel,
    metric: b.metric as 'TOKENS' | 'COST_USD',
    hardLimit: b.hardLimit,
    softLimit: b.softLimit,
    warningThreshold: b.warningThreshold,
    resetPeriod: b.resetPeriod as PolicyPackBudget['resetPeriod'],
    priority: b.priority,
    fallbackBehavior: b.fallbackBehavior as PolicyPackBudget['fallbackBehavior'],
  }));
  const packPolicies: PolicyPackPolicy[] = [];
  for (const b of budgets) {
    for (const pol of b.policies) {
      packPolicies.push({
        budgetName: b.name,
        name: pol.name,
        condition: pol.condition,
        action: pol.action as PolicyPackPolicy['action'],
        params: pol.params ? (JSON.parse(pol.params) as Record<string, unknown>) : undefined,
        priority: pol.priority,
      });
    }
  }
  return {
    kind: POLICY_PACK_KIND,
    version: 1,
    id: packId,
    name: `Export of org ${organizationId.slice(0, 8)}`,
    description: 'Live budgets and policies exported from this organization.',
    process: 'export',
    budgets: packBudgets,
    policies: packPolicies,
  };
}

export async function importPolicyPack(params: {
  organizationId: string;
  pack: PolicyPack;
  scopeBindings?: ScopeBindings;
}): Promise<{ budgetsCreated: number; policiesCreated: number; budgetIds: string[] }> {
  const { organizationId, pack, scopeBindings } = params;
  const budgetIds: string[] = [];
  const idByName = new Map<string, string>();

  for (const b of pack.budgets) {
    const created = await prisma.budget.create({
      data: {
        organizationId,
        name: b.name,
        level: b.level,
        scopeId: resolveScopeId(b, scopeBindings),
        metric: b.metric,
        hardLimit: b.hardLimit,
        softLimit: b.softLimit ?? null,
        warningThreshold: b.warningThreshold ?? 0.8,
        resetPeriod: b.resetPeriod ?? 'MONTHLY',
        priority: b.priority ?? 5,
        fallbackBehavior: b.fallbackBehavior ?? 'BLOCK',
      },
    });
    idByName.set(b.name, created.id);
    budgetIds.push(created.id);
  }

  let policiesCreated = 0;
  for (const pol of pack.policies) {
    const budgetId = idByName.get(pol.budgetName);
    if (!budgetId) throw new Error(`policy "${pol.name}" references unknown budget "${pol.budgetName}"`);
    await prisma.budgetPolicy.create({
      data: {
        budgetId,
        name: pol.name,
        condition: pol.condition,
        action: pol.action,
        params: pol.params ? JSON.stringify(pol.params) : null,
        priority: pol.priority ?? 5,
      },
    });
    policiesCreated += 1;
  }

  return { budgetsCreated: pack.budgets.length, policiesCreated, budgetIds };
}
