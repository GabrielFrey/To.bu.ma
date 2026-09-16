import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import type { ChatTurnMessage, ToolCallRequest } from '../providers/types.js';
import { writeAudit } from '../services/audit.js';
import { hashArgs, mintConfirmToken, verifyConfirmToken } from './confirm.js';
import { ensureConversationScope } from './identity.js';
import { runAssistantTurn } from './llm.js';
import {
  classifyCall,
  getTool,
  requiresConfirmation,
  ToolInputError,
  toolSpecs,
  type Risk,
  type ToolContext,
} from './tools.js';

const SYSTEM_PROMPT = [
  'You are the Token Budget Manager assistant, embedded in the product itself.',
  'You help operators understand and control LLM spend for their organization.',
  'Prefer calling a tool over guessing: never invent numbers, budget names or agent names.',
  'When a tool returns data, answer in one or two short sentences with the concrete figures.',
  'Some actions are gated and will come back needing explicit confirmation; when that happens,',
  'explain plainly what will change and wait. Never try to work around a gate.',
  'Your own LLM usage is metered by this product under the agent "tbm-assistant".',
].join(' ');

export interface ToolCallView {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  risk: Risk;
  status: string;
  summary: string;
  result?: unknown;
  error?: string;
  durationMs: number;
  /** Present only while the call is waiting for confirmation. */
  confirm?: { reason: string; confirmToken: string; expiresAt: string };
}

export interface UsageStep {
  requestId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  decision: string;
}

export interface ChatTurnResponse {
  conversationId: string;
  reply: string;
  toolCalls: ToolCallView[];
  pendingConfirmations: ToolCallView[];
  usage: {
    steps: UsageStep[];
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  blocked?: {
    decision: string;
    reason: string;
    budgets: { name: string; level: string; utilization: number; hardLimit: number }[];
  };
  stoppedBecause: 'answered' | 'awaiting_confirmation' | 'budget_blocked' | 'step_limit';
}

export const confirmationSchema = z.object({
  toolCallId: z.string(),
  confirmToken: z.string(),
  /** Set false to explicitly refuse a gated call and let the assistant continue. */
  approve: z.boolean().default(true),
});

export type Confirmation = z.infer<typeof confirmationSchema>;

export interface ChatTurnInput {
  organizationId: string;
  conversationId?: string;
  message?: string;
  confirmations?: Confirmation[];
  /** Audit actor of the human driving the assistant. */
  actor: string;
  /** Optional streaming sink; called as the turn progresses. */
  onEvent?: (event: StreamEvent) => void;
}

export type StreamEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'tool_call'; call: ToolCallView }
  | { type: 'tool_result'; call: ToolCallView }
  | { type: 'pending_confirmation'; call: ToolCallView }
  | { type: 'usage'; step: UsageStep }
  | { type: 'delta'; text: string }
  | { type: 'blocked'; decision: string; reason: string }
  | { type: 'done'; response: ChatTurnResponse };

function titleFrom(message: string): string {
  const clean = message.trim().replace(/\s+/g, ' ');
  return clean.length <= 60 ? clean || 'New conversation' : `${clean.slice(0, 57)}…`;
}

async function loadTranscript(conversationId: string): Promise<ChatTurnMessage[]> {
  const rows = await prisma.assistantMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    include: { toolCalls: true },
  });
  return rows.map((m) => ({
    role: m.role,
    content: m.content,
    name: m.name ?? undefined,
    toolCallId: m.toolCallId ?? undefined,
    toolCalls: m.toolCalls.length
      ? m.toolCalls.map((c) => ({ id: c.id, name: c.tool, arguments: safeJson(c.args) }))
      : undefined,
  }));
}

function safeJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function viewOf(row: {
  id: string;
  tool: string;
  args: string;
  risk: string;
  status: string;
  result: string | null;
  error: string | null;
  durationMs: number;
}): ToolCallView {
  const tool = getTool(row.tool);
  const args = safeJson(row.args);
  return {
    id: row.id,
    tool: row.tool,
    args,
    risk: row.risk as Risk,
    status: row.status,
    summary: tool?.summarize ? safeSummary(tool, args) : row.tool,
    result: row.result ? safeJson(row.result) : undefined,
    error: row.error ?? undefined,
    durationMs: row.durationMs,
  };
}

function safeSummary(tool: { summarize?: (a: never) => string; name: string }, args: unknown): string {
  try {
    return tool.summarize ? tool.summarize(args as never) : tool.name;
  } catch {
    return tool.name;
  }
}

/**
 * Execute one validated tool call and persist the outcome. Every path — success,
 * validation failure, handler error — writes both an AssistantToolCall row and an
 * audit-log entry, so the audit trail can never be shorter than what happened.
 */
async function executeTool(params: {
  callRowId: string;
  toolName: string;
  rawArgs: Record<string, unknown>;
  risk: Risk;
  ctx: ToolContext;
  actor: string;
}): Promise<{ status: 'executed' | 'error'; payload: unknown }> {
  const tool = getTool(params.toolName);
  const startedAt = Date.now();

  const finish = async (
    status: 'executed' | 'error',
    payload: unknown,
    error?: string
  ): Promise<{ status: 'executed' | 'error'; payload: unknown }> => {
    const durationMs = Date.now() - startedAt;
    await prisma.assistantToolCall.update({
      where: { id: params.callRowId },
      data: {
        status,
        result: status === 'executed' ? JSON.stringify(payload).slice(0, 100_000) : null,
        error: error ?? null,
        durationMs,
        executedAt: new Date(),
      },
    });
    await writeAudit({
      organizationId: params.ctx.organizationId,
      actor: params.actor,
      action: `assistant.tool.${params.toolName}`,
      target: params.callRowId,
      metadata: {
        conversationId: params.ctx.conversationId,
        risk: params.risk,
        status,
        args: params.rawArgs,
        durationMs,
        ...(error ? { error } : {}),
      },
    });
    return { status, payload: status === 'executed' ? payload : { error } };
  };

  if (!tool) return finish('error', null, `unknown tool "${params.toolName}"`);

  const parsed = tool.schema.safeParse(params.rawArgs);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return finish('error', null, `invalid arguments — ${detail}`);
  }

  try {
    const result = await tool.handler(parsed.data, params.ctx);
    return finish('executed', result ?? null);
  } catch (err) {
    const message = err instanceof ToolInputError ? err.message : (err as Error).message;
    return finish('error', null, message);
  }
}

/**
 * One user turn: provider → optional tool calls → provider → answer.
 *
 * Gated calls stop the loop and surface a confirm token instead of executing; the
 * client re-enters with `confirmations` and the loop resumes from the same
 * transcript, so the model never sees a half-finished tool exchange.
 */
export async function runChatTurn(input: ChatTurnInput): Promise<ChatTurnResponse> {
  const { organizationId, actor } = input;
  const emit = input.onEvent ?? (() => {});

  const conversation = input.conversationId
    ? await prisma.assistantConversation.findFirst({
        where: { id: input.conversationId, organizationId },
      })
    : null;
  if (input.conversationId && !conversation) {
    throw Object.assign(new Error('conversation not found'), { statusCode: 404 });
  }

  const convo =
    conversation ??
    (await prisma.assistantConversation.create({
      data: { organizationId, title: titleFrom(input.message ?? 'New conversation') },
    }));
  emit({ type: 'conversation', conversationId: convo.id });

  const ctx: ToolContext = {
    organizationId,
    actor: `assistant:${convo.id}`,
    conversationId: convo.id,
  };
  // The audit actor names both the human and the conversation, so "the assistant
  // did it" is never the whole answer to "who did this".
  const auditActor = `${actor} via assistant:${convo.id}`;

  const toolCallViews: ToolCallView[] = [];
  const usageSteps: UsageStep[] = [];

  // ---- 1. Resolve any confirmations for previously gated calls -------------
  for (const confirmation of input.confirmations ?? []) {
    const row = await prisma.assistantToolCall.findFirst({
      where: { id: confirmation.toolCallId, organizationId, conversationId: convo.id },
    });
    if (!row) throw Object.assign(new Error('tool call not found'), { statusCode: 404 });
    if (row.status !== 'pending_confirmation') {
      // Single-use: a confirmed or denied call cannot be replayed.
      toolCallViews.push({ ...viewOf(row), error: `already ${row.status}` });
      continue;
    }

    const args = safeJson(row.args);
    if (!confirmation.approve) {
      await prisma.assistantToolCall.update({ where: { id: row.id }, data: { status: 'denied' } });
      await writeAudit({
        organizationId,
        actor: auditActor,
        action: `assistant.tool.${row.tool}`,
        target: row.id,
        metadata: { conversationId: convo.id, risk: row.risk, status: 'denied', args },
      });
      await appendToolMessage(convo.id, organizationId, row.id, row.tool, {
        denied: true,
        note: 'The operator declined this action. Do not retry it.',
      });
      toolCallViews.push({ ...viewOf(row), status: 'denied' });
      continue;
    }

    const verdict = verifyConfirmToken(confirmation.confirmToken, {
      organizationId,
      toolCallId: row.id,
      tool: row.tool,
      args,
    });
    if (!verdict.valid) {
      await prisma.assistantToolCall.update({
        where: { id: row.id },
        data: { status: verdict.reason === 'expired' ? 'expired' : 'denied', error: `confirmation ${verdict.reason}` },
      });
      await writeAudit({
        organizationId,
        actor: auditActor,
        action: `assistant.tool.${row.tool}`,
        target: row.id,
        metadata: { conversationId: convo.id, status: 'rejected', reason: verdict.reason, args },
      });
      throw Object.assign(new Error(`confirmation token ${verdict.reason}`), { statusCode: 400 });
    }

    const outcome = await executeTool({
      callRowId: row.id,
      toolName: row.tool,
      rawArgs: args,
      risk: row.risk as Risk,
      ctx,
      actor: auditActor,
    });
    await appendToolMessage(convo.id, organizationId, row.id, row.tool, outcome.payload);
    const view = viewOf(
      (await prisma.assistantToolCall.findUniqueOrThrow({ where: { id: row.id } }))
    );
    toolCallViews.push(view);
    emit({ type: 'tool_result', call: view });
  }

  // ---- 2. Record the new user message -------------------------------------
  if (input.message?.trim()) {
    await prisma.assistantMessage.create({
      data: {
        conversationId: convo.id,
        organizationId,
        role: 'user',
        content: input.message.trim(),
      },
    });
  }

  // ---- 3. Provider loop ---------------------------------------------------
  const scope = await ensureConversationScope(organizationId, convo.id);
  const specs = toolSpecs();
  let reply = '';
  let stoppedBecause: ChatTurnResponse['stoppedBecause'] = 'step_limit';
  let blocked: ChatTurnResponse['blocked'];
  const pending: ToolCallView[] = [];

  for (let step = 0; step < config.assistantMaxSteps; step++) {
    const transcript = await loadTranscript(convo.id);
    const turn = await runAssistantTurn({
      chain: scope,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...transcript],
      tools: specs,
    });

    if (turn.kind === 'blocked') {
      blocked = { decision: turn.decision, reason: turn.reason, budgets: turn.budgets };
      reply =
        reply ||
        `I could not run that: my own budget blocked me (${turn.reason}). ` +
          `Raise or reset the "${
            turn.budgets[0]?.name ?? 'tbm-assistant'
          }" budget to let me continue — this is the product enforcing its limits on itself.`;
      stoppedBecause = 'budget_blocked';
      emit({ type: 'blocked', decision: turn.decision, reason: turn.reason });
      break;
    }

    const usageStep: UsageStep = {
      requestId: turn.requestId,
      model: turn.chat.model,
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      costUsd: turn.costUsd,
      latencyMs: turn.latencyMs,
      decision: turn.decision,
    };
    usageSteps.push(usageStep);
    emit({ type: 'usage', step: usageStep });

    const assistantMessage = await prisma.assistantMessage.create({
      data: {
        conversationId: convo.id,
        organizationId,
        role: 'assistant',
        content: turn.chat.content ?? '',
        requestId: turn.requestId,
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        costUsd: turn.costUsd,
      },
    });

    if (turn.chat.toolCalls.length === 0) {
      reply = turn.chat.content ?? '';
      stoppedBecause = 'answered';
      if (reply) emit({ type: 'delta', text: reply });
      break;
    }

    const gatedThisStep = await handleToolCalls({
      calls: turn.chat.toolCalls,
      messageId: assistantMessage.id,
      convoId: convo.id,
      organizationId,
      ctx,
      auditActor,
      views: toolCallViews,
      pending,
      emit,
    });

    if (gatedThisStep) {
      reply = confirmationPrompt(pending);
      stoppedBecause = 'awaiting_confirmation';
      break;
    }
  }

  if (stoppedBecause === 'step_limit' && !reply) {
    reply =
      'I stopped after the maximum number of steps for one turn. Ask me again, more narrowly, and I will continue.';
  }

  if (reply) {
    await prisma.assistantMessage.create({
      data: { conversationId: convo.id, organizationId, role: 'assistant', content: reply },
    });
  }
  await prisma.assistantConversation.update({
    where: { id: convo.id },
    data: { updatedAt: new Date() },
  });

  const response: ChatTurnResponse = {
    conversationId: convo.id,
    reply,
    toolCalls: toolCallViews,
    pendingConfirmations: pending,
    usage: {
      steps: usageSteps,
      inputTokens: usageSteps.reduce((s, u) => s + u.inputTokens, 0),
      outputTokens: usageSteps.reduce((s, u) => s + u.outputTokens, 0),
      costUsd: Number(usageSteps.reduce((s, u) => s + u.costUsd, 0).toFixed(6)),
    },
    blocked,
    stoppedBecause,
  };
  emit({ type: 'done', response });
  return response;
}

/** Returns true when at least one call was gated (so the turn must pause). */
async function handleToolCalls(params: {
  calls: ToolCallRequest[];
  messageId: string;
  convoId: string;
  organizationId: string;
  ctx: ToolContext;
  auditActor: string;
  views: ToolCallView[];
  pending: ToolCallView[];
  emit: (e: StreamEvent) => void;
}): Promise<boolean> {
  let gated = false;

  for (const call of params.calls) {
    const tool = getTool(call.name);
    const verdict = tool
      ? await classifyCall(tool, call.arguments, params.ctx)
      : { risk: 'read' as Risk, reason: undefined };

    const row = await prisma.assistantToolCall.create({
      data: {
        conversationId: params.convoId,
        organizationId: params.organizationId,
        messageId: params.messageId,
        tool: call.name,
        args: JSON.stringify(call.arguments ?? {}),
        risk: verdict.risk,
        status: requiresConfirmation(verdict.risk) ? 'pending_confirmation' : 'executed',
        actor: params.auditActor,
      },
    });
    params.emit({ type: 'tool_call', call: viewOf(row) });

    if (requiresConfirmation(verdict.risk)) {
      gated = true;
      const minted = mintConfirmToken({
        organizationId: params.organizationId,
        toolCallId: row.id,
        tool: call.name,
        args: call.arguments ?? {},
      });
      // Gated calls are recorded before they run, so an abandoned confirmation is
      // still visible in the audit trail as something the assistant wanted to do.
      await writeAudit({
        organizationId: params.organizationId,
        actor: params.auditActor,
        action: `assistant.tool.${call.name}`,
        target: row.id,
        metadata: {
          conversationId: params.convoId,
          risk: verdict.risk,
          status: 'pending_confirmation',
          reason: verdict.reason,
          args: call.arguments,
          argsHash: hashArgs(call.arguments ?? {}),
        },
      });
      const view: ToolCallView = {
        ...viewOf(row),
        confirm: {
          reason: verdict.reason ?? 'this action needs explicit confirmation',
          confirmToken: minted.confirmToken,
          expiresAt: minted.expiresAt,
        },
      };
      params.pending.push(view);
      params.views.push(view);
      params.emit({ type: 'pending_confirmation', call: view });
      continue;
    }

    const outcome = await executeTool({
      callRowId: row.id,
      toolName: call.name,
      rawArgs: (call.arguments ?? {}) as Record<string, unknown>,
      risk: verdict.risk,
      ctx: params.ctx,
      actor: params.auditActor,
    });
    await appendToolMessage(params.convoId, params.organizationId, row.id, call.name, outcome.payload);
    const view = viewOf(await prisma.assistantToolCall.findUniqueOrThrow({ where: { id: row.id } }));
    params.views.push(view);
    params.emit({ type: 'tool_result', call: view });
  }

  return gated;
}

/** Feed a tool result back to the model as a `role: 'tool'` transcript entry. */
async function appendToolMessage(
  conversationId: string,
  organizationId: string,
  toolCallId: string,
  toolName: string,
  payload: unknown
): Promise<void> {
  await prisma.assistantMessage.create({
    data: {
      conversationId,
      organizationId,
      role: 'tool',
      name: toolName,
      toolCallId,
      // Cap what goes back into the prompt: a chargeback CSV or a 500-row ledger
      // would otherwise dominate the next turn's token bill.
      content: JSON.stringify(payload ?? null).slice(0, 8_000),
    },
  });
}

function confirmationPrompt(pending: ToolCallView[]): string {
  if (pending.length === 1) {
    const p = pending[0];
    return `Before I do that: **${p.summary}** — ${p.confirm?.reason}. Confirm to proceed.`;
  }
  const list = pending.map((p) => `- **${p.summary}** — ${p.confirm?.reason}`).join('\n');
  return `These actions need your confirmation first:\n${list}`;
}
