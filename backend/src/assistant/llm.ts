import { config } from '../config.js';
import { prisma } from '../db.js';
import { decryptSecret } from '../crypto.js';
import { getProvider } from '../providers/index.js';
import type { ChatResult, ChatTurnMessage, ToolSpec } from '../providers/types.js';
import { recordUsage } from '../services/accounting.js';
import { checkBudget } from '../services/gateway.js';
import type { ScopeChain } from '../types.js';

export interface AssistantTurnResult {
  kind: 'ok';
  chat: ChatResult;
  requestId: string;
  decision: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface AssistantTurnBlocked {
  kind: 'blocked';
  decision: string;
  reason: string;
  requestId: string | null;
  budgets: { name: string; level: string; utilization: number; hardLimit: number }[];
}

export type AssistantTurn = AssistantTurnResult | AssistantTurnBlocked;

async function loadKey(organizationId: string, provider: string): Promise<string | undefined> {
  if (provider !== 'openai') return undefined;
  const pk = await prisma.providerKey.findFirst({ where: { organizationId, provider: 'openai' } });
  if (pk) return decryptSecret(pk.ciphertext);
  return config.openaiApiKey || undefined;
}

/**
 * Run one assistant LLM turn **through this product's own gateway**.
 *
 * This is the dogfooding requirement, and it is deliberately the same code path
 * the transparent proxy uses: `checkBudget` (estimate → budgets → policies →
 * reserve → verify) before the call, `recordUsage` after it. The consequences are
 * real, not cosmetic:
 *   - the assistant's tokens appear in /v1/analytics/* under agent `tbm-assistant`
 *   - a tenant can cap the assistant with an ordinary budget, and when that cap
 *     is hit the assistant is blocked exactly like any other agent
 *   - pausing the `tbm-assistant` agent stops it
 *
 * The call runs in-process rather than looping back over HTTP: same enforcement,
 * same accounting, no self-connection to keep alive. `TBM_ASSISTANT_PROVIDER`
 * selects the upstream, defaulting to the offline mock.
 */
export async function runAssistantTurn(params: {
  chain: ScopeChain;
  messages: ChatTurnMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
}): Promise<AssistantTurn> {
  const providerName = config.assistantProvider;
  const model = config.assistantModel;

  const check = await checkBudget({
    chain: params.chain,
    model,
    provider: providerName,
    // The gateway reasons about plain text; tool schemas ride along as a system
    // hint so their token weight is not invisible to the estimate.
    messages: [
      ...params.messages.map((m) => ({ role: m.role, content: m.content, name: m.name })),
      { role: 'system', content: JSON.stringify(params.tools).slice(0, 20_000) },
    ],
    expectedCompletionTokens: params.maxTokens ?? 512,
    toolCalls: params.tools.length,
  });

  if (!check.allowed) {
    return {
      kind: 'blocked',
      decision: check.decision,
      reason: check.reason,
      requestId: check.requestId,
      budgets: check.budgets
        .filter((b) => b.exceedsHard || b.atWarning)
        .map((b) => ({ name: b.name, level: b.level, utilization: b.utilization, hardLimit: b.hardLimit })),
    };
  }

  const provider = getProvider(providerName);
  if (!provider.chat) {
    throw new Error(`Provider "${providerName}" does not support tool calling`);
  }

  const apiKey = await loadKey(params.chain.organizationId, providerName);
  const startedAt = Date.now();
  try {
    const chat = await provider.chat(
      { model, messages: params.messages, tools: params.tools, maxTokens: params.maxTokens ?? 512 },
      apiKey
    );
    const rec = await recordUsage({
      requestId: check.requestId!,
      organizationId: params.chain.organizationId,
      model: chat.model,
      usage: chat.usage,
      status: 'completed',
    });
    return {
      kind: 'ok',
      chat,
      requestId: check.requestId!,
      decision: check.decision,
      inputTokens: rec.usage.inputTokens,
      outputTokens: rec.usage.outputTokens,
      costUsd: rec.usage.costUsd,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    // Failed provider calls still consumed prompt tokens upstream in most cases,
    // and leaving the reservation open would hold budget headroom hostage.
    await recordUsage({
      requestId: check.requestId!,
      organizationId: params.chain.organizationId,
      usage: { inputTokens: check.forecast.promptTokens, outputTokens: 0 },
      status: 'failed',
    });
    throw err;
  }
}
