import { config } from '../config.js';
import { prisma } from '../db.js';
import { estimateCost } from '../pricing.js';
import { estimateTokens, type ChatMessage } from '../tokenizer.js';
import type { Decision, ScopeChain } from '../types.js';
import { resolveBudgets, type BudgetStatus } from './budgetEngine.js';
import { detectLoopSignals, requestSignature } from './loopDetection.js';
import { evaluatePolicies, type PolicyDecision } from './policyEngine.js';
import { chooseModel } from './optimization.js';
import { createReservation } from './accounting.js';

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

  // Recommend a cheaper model when degrading/compressing.
  let recommendedModel: string | undefined;
  if (['degrade', 'compress', 'summarize'].includes(policy.decision)) {
    const c = await chooseModel({
      requestedModel: input.model,
      promptTokens,
      organizationId: input.chain.organizationId,
      preferCheaper: true,
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
  if (policy.decision === 'require-approval') {
    await prisma.approval.create({
      data: {
        organizationId: input.chain.organizationId,
        requestId: reservation.id,
        reason: policy.reason,
        status: 'pending',
      },
    });
  }

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
  };
}
