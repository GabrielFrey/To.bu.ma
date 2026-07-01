export type BudgetLevel =
  | 'ORGANIZATION'
  | 'PROJECT'
  | 'USER'
  | 'AGENT'
  | 'SESSION'
  | 'TASK'
  | 'TOOL_CALL'
  | 'REQUEST';

export type BudgetMetric = 'TOKENS' | 'COST_USD';

export type ResetPeriod = 'NEVER' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

export type FallbackBehavior =
  | 'BLOCK'
  | 'DEGRADE'
  | 'SUMMARIZE'
  | 'REQUIRE_APPROVAL'
  | 'STOP_AGENT';

export type Decision =
  | 'allow'
  | 'warn'
  | 'degrade'
  | 'compress'
  | 'summarize'
  | 'truncate'
  | 'require-approval'
  | 'stop-agent'
  | 'retry-limit'
  | 'tool-limit';

/** Strength ordering for most-restrictive-wins (higher = stronger). */
export const DECISION_STRENGTH: Record<Decision, number> = {
  allow: 0,
  warn: 1,
  degrade: 2,
  compress: 3,
  summarize: 3,
  truncate: 4,
  'require-approval': 5,
  'tool-limit': 6,
  'retry-limit': 6,
  'stop-agent': 7,
};

/** Decisions that block the call from proceeding. */
export const BLOCKING_DECISIONS: ReadonlySet<Decision> = new Set<Decision>([
  'require-approval',
  'stop-agent',
  'retry-limit',
  'tool-limit',
]);

export interface ScopeChain {
  organizationId: string;
  projectId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  taskId?: string | null;
}
