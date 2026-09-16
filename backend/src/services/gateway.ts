import { config } from '../config.js';
import { prisma } from '../db.js';
import { estimateCost } from '../pricing.js';
import { estimateTokens, type ChatMessage } from '../tokenizer.js';
import { BLOCKING_DECISIONS, type Decision, type ScopeChain } from '../types.js';
import { resolveBudgets, type BudgetStatus } from './budgetEngine.js';
import { detectLoopSignals, requestSignature } from './loopDetection.js';
import { evaluatePolicies, type PolicyDecision } from './policyEngine.js';
import { chooseModel } from './optimization.js';
import { createReservation } from './accounting.js';
import { emitEvent, approvalLinks, type EventType } from './events.js';
import { lookupPromptCache, type PromptCacheHint } from './promptCache.js';

export interface CheckBudgetInput {
  chain: ScopeChain;
  model: string;
  provider?: string;
  messages: ChatMessage[];
  expectedCompletionTokens?: number;
  toolCalls?: number;
}

export interface CheckBudgetResult {
  requestId: string | null;
  decision: Decision;
  allowed: boolean;
  reason: string;
  forecast: {
    promptTokens: number;
    expectedCompletionTokens: number;
    reservedTokens: number;
    estimatedCostUsd: number;
    overflowRisk: boolean;
  };
  budgets: BudgetStatus[];
  recommendedModel?: string;
  signals: { signatureRepeats: number; failedAttempts: number };
  policy: PolicyDecision;
  promptCache: PromptCacheHint;
}

/**
 * Full pre-request gateway: estimate → resolve budgets → detect loops →
 * evaluate policies → create a reservation (or a blocked record). This is the
 * enforcement point that guarantees hard budgets cannot be exceeded.
 */
export async function checkBudget(input: CheckBudgetInput): Promise<CheckBudgetResult> {
  const provider = input.provider ?? 'mock';
  const promptTokens = estimateTokens(input.messages, input.model);
  const expectedCompletionTokens = input.expectedCompletionTokens ?? 256;
  const reservedTokens = Math.ceil(
    promptTokens + expectedCompletionTokens * (1 + config.reservationSafetyMargin)
  );
  const estimatedCostUsd = await estimateCost(
    input.model,
    promptTokens,
    expectedCompletionTokens,
    input.chain.organizationId
  );

  const budgets = await resolveBudgets(input.chain, reservedTokens, estimatedCostUsd);
  const overflowRisk = budgets.some((b) => b.exceedsHard);

  const signature = requestSignature(input.messages, input.model);
  const promptCache = await lookupPromptCache({
    organizationId: input.chain.organizationId,
    signature,
  });
  const loop = await detectLoopSignals({
    sessionId: input.chain.sessionId,
    taskId: input.chain.taskId,
    signature,
    loopThreshold: config.loopThreshold,
    retryThreshold: config.retryThreshold,
  });

  // Is the agent paused?
  let agentPaused = false;
  if (input.chain.agentId) {
    const agent = await prisma.agent.findUnique({ where: { id: input.chain.agentId } });
    agentPaused = agent?.status === 'paused';
  }

  const policy = await evaluatePolicies({
    chain: input.chain,
    budgets,
    loop,
    toolCalls: input.toolCalls,
    requestCost: estimatedCostUsd,
    agentPaused,
    persist: true,
  });

  const allowed = !policy.blocked;

  // Price-aware routing: cheapest model that still fits remaining budget.
  let recommendedModel: string | undefined;
  const remaining = remainingCaps(budgets);
  if (['degrade', 'compress', 'summarize'].includes(policy.decision) || overflowRisk) {
    const c = await chooseModel({
      requestedModel: input.model,
      promptTokens,
      expectedCompletionTokens,
      organizationId: input.chain.organizationId,
      preferCheaper: true,
      remainingBudgetUsd: remaining.remainingBudgetUsd,
      remainingBudgetTokens: remaining.remainingBudgetTokens,
    });
    if (c.model !== input.model) recommendedModel = c.model;
  }

  // Persist the request as a reservation (allowed) or a blocked record.
  // Either way, every request is accounted.
  const reservation = await createReservation({
    chain: input.chain,
    model: input.model,
    provider,
    promptTokens,
    expectedCompletionTokens,
    reservedTokens,
    estimatedCostUsd,
    signature,
    decision: policy.decision,
    status: allowed ? 'reserved' : 'blocked',
  });

  // Create an approval record if required.
  let approvalId: string | undefined;
  if (policy.decision === 'require-approval') {
    const approval = await prisma.approval.create({
      data: {
        organizationId: input.chain.organizationId,
        requestId: reservation.id,
        reason: policy.reason,
        status: 'pending',
      },
    });
    approvalId = approval.id;
  }

  // Fan out events (best-effort; drives webhooks + notifications). Mapped from
  // the effective decision + contributing budget.
  await emitDecisionEvents(input.chain, policy, budgets, approvalId);

  return {
    requestId: reservation.id,
    decision: policy.decision,
    allowed,
    reason: policy.reason,
    forecast: {
      promptTokens,
      expectedCompletionTokens,
      reservedTokens,
      estimatedCostUsd,
      overflowRisk,
    },
    budgets,
    recommendedModel,
    signals: { signatureRepeats: loop.signatureRepeats, failedAttempts: loop.failedAttempts },
    policy,
    promptCache,
  };
}

function remainingCaps(budgets: BudgetStatus[]): {
  remainingBudgetUsd?: number;
  remainingBudgetTokens?: number;
} {
  let remainingBudgetUsd: number | undefined;
  let remainingBudgetTokens: number | undefined;
  for (const b of budgets) {
    if (b.metric === 'COST_USD') {
      remainingBudgetUsd =
        remainingBudgetUsd == null ? b.remaining : Math.min(remainingBudgetUsd, b.remaining);
    } else {
      remainingBudgetTokens =
        remainingBudgetTokens == null ? b.remaining : Math.min(remainingBudgetTokens, b.remaining);
    }
  }
  return { remainingBudgetUsd, remainingBudgetTokens };
}

/** Translate a policy decision into an emitted event (for webhooks/notifications). */
async function emitDecisionEvents(
  chain: ScopeChain,
  policy: PolicyDecision,
  budgets: BudgetStatus[],
  approvalId?: string
): Promise<void> {
  const budget = policy.budgetId ? budgets.find((b) => b.budgetId === policy.budgetId) : undefined;
  const budgetName = budget?.name ?? 'budget';
  const emit = (type: EventType, data: Record<string, unknown>) =>
    emitEvent({ organizationId: chain.organizationId, type, data: { agentId: chain.agentId ?? null, taskId: chain.taskId ?? null, ...data } }).catch(() => {});

  const decision = policy.decision as Decision;
  if (BLOCKING_DECISIONS.has(decision)) {
    await emit('call_blocked', { budgetName, decision, reason: policy.reason });
  } else if (['degrade', 'compress', 'summarize', 'truncate'].includes(decision)) {
    await emit('call_degraded', { budgetName, decision, reason: policy.reason });
  }

  switch (policy.decision) {
    case 'warn':
      await emit('warning_threshold', { budgetName, utilization: policy.utilization ?? budget?.utilization ?? 0 });
      break;
    case 'degrade':
    case 'compress':
    case 'summarize':
      await emit('soft_limit_crossed', { budgetName, decision: policy.decision, reason: policy.reason });
      break;
    case 'require-approval':
      if (approvalId) {
        await emit('approval_required', { reason: policy.reason, approvalId, ...approvalLinks(approvalId) });
      }
      break;
    case 'stop-agent':
      if (/loop/i.test(policy.reason)) await emit('loop_stopped', { reason: policy.reason });
      else await emit('hard_limit_blocked', { budgetName, reason: policy.reason });
      break;
    case 'retry-limit':
    case 'tool-limit':
      await emit('hard_limit_blocked', { budgetName, reason: policy.reason, decision: policy.decision });
      break;
    default:
      break;
  }
}
