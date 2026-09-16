import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { resetDb } from './helpers.js';
import { buildServer } from '../src/server.js';
import { hashApiKey } from '../src/crypto.js';
import { mintConfirmToken, verifyConfirmToken } from '../src/assistant/confirm.js';
import {
  alwaysGatedTools,
  classifyCall,
  conditionallyGatedTools,
  getTool,
  TOOLS,
  toolSpecs,
} from '../src/assistant/tools.js';
import { ASSISTANT_AGENT, ensureAssistantIdentity } from '../src/assistant/identity.js';

const API_KEY = 'tbm_assistant_test';
const headers = { 'x-api-key': API_KEY, 'content-type': 'application/json' };

async function seedTenant() {
  const org = await prisma.organization.create({ data: { name: 'Assistant Org' } });
  await prisma.apiKey.create({
    data: { organizationId: org.id, name: 'k', keyHash: hashApiKey(API_KEY), role: 'owner' },
  });
  const project = await prisma.project.create({ data: { organizationId: org.id, name: 'Ops' } });
  const agent = await prisma.agent.create({ data: { projectId: project.id, name: 'Triage Agent' } });
  const session = await prisma.session.create({ data: { agentId: agent.id } });
  const task = await prisma.task.create({ data: { sessionId: session.id, name: 'classify' } });
  await prisma.modelPricing.create({
    data: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      organizationId: null,
      inputPerMTokens: 0.15,
      outputPerMTokens: 0.6,
      cachedPerMTokens: 0.075,
      contextWindow: 128000,
    },
  });
  return { org, project, agent, session, task };
}

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  if (app) await app.close();
  app = await buildServer();
});
afterAll(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

const chat = (payload: unknown) =>
  app.inject({ method: 'POST', url: '/v1/assistant/chat', headers, payload: payload as never });

// ---------------------------------------------------------------------------

describe('tool registry', () => {
  it('exposes every documented tool with a unique name and a JSON schema', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);

    // The surface promised in docs/ASSISTANT.md and the product spec.
    const required = [
      'get_spend_summary',
      'get_spend_by_agent',
      'get_spend_by_task',
      'list_budgets',
      'create_budget',
      'update_budget',
      'delete_budget',
      'list_policies',
      'create_policy',
      'simulate_policies',
      'forecast_run',
      'get_savings_ledger',
      'list_blocked_requests',
      'list_loops',
      'pause_agent',
      'resume_agent',
      'approve_request',
      'export_chargeback_csv',
      'import_policy_pack',
    ];
    for (const name of required) expect(names, `missing tool ${name}`).toContain(name);

    for (const spec of toolSpecs()) {
      expect(spec.description.length).toBeGreaterThan(20);
      expect(spec.parameters).toHaveProperty('type', 'object');
      expect(spec.parameters).toHaveProperty('properties');
    }
  });

  it('derives JSON schema properties, enums, defaults and required fields from zod', () => {
    const spec = toolSpecs().find((s) => s.name === 'create_budget')!;
    const params = spec.parameters as {
      properties: Record<string, { type?: string; enum?: string[]; default?: unknown }>;
      required?: string[];
    };
    expect(params.properties.hardLimit.type).toBe('number');
    expect(params.properties.level.enum).toContain('AGENT');
    expect(params.properties.metric.default).toBe('TOKENS');
    // name/level/hardLimit have no defaults, so they are required; metric does.
    expect(params.required).toEqual(expect.arrayContaining(['name', 'level', 'hardLimit']));
    expect(params.required).not.toContain('metric');
  });

  it('classifies read, write and destructive tools as documented', async () => {
    expect(alwaysGatedTools().sort()).toEqual(
      ['delete_budget', 'import_policy_pack', 'resume_agent'].sort()
    );
    expect(conditionallyGatedTools().sort()).toEqual(
      ['approve_request', 'create_policy', 'update_budget'].sort()
    );
    expect(getTool('get_spend_summary')!.risk).toBe('read');
    expect(getTool('create_budget')!.risk).toBe('write');
    expect(getTool('pause_agent')!.risk).toBe('write');
  });
});

describe('confirmation gating', () => {
  it('escalates update_budget only when it raises a limit or deactivates a budget', async () => {
    const { org } = await seedTenant();
    const budget = await prisma.budget.create({
      data: { organizationId: org.id, name: 'Org cap', level: 'ORGANIZATION', hardLimit: 1000 },
    });
    const ctx = { organizationId: org.id, actor: 'test', conversationId: 'c1' };
    const tool = getTool('update_budget')!;

    const lower = await classifyCall(tool, { budgetName: budget.name, hardLimit: 500 }, ctx);
    expect(lower.risk).toBe('write');

    const raise = await classifyCall(tool, { budgetName: budget.name, hardLimit: 5000 }, ctx);
    expect(raise.risk).toBe('destructive');
    expect(raise.reason).toMatch(/raises the hard limit/);

    const deactivate = await classifyCall(tool, { budgetName: budget.name, active: false }, ctx);
    expect(deactivate.risk).toBe('destructive');
    expect(deactivate.reason).toMatch(/removes the guardrail/);
  });

  it('escalates approve_request only above the dollar threshold', async () => {
    const { org, agent } = await seedTenant();
    const ctx = { organizationId: org.id, actor: 'test', conversationId: 'c1' };
    const tool = getTool('approve_request')!;

    const mkApproval = async (estimatedCostUsd: number) => {
      const req = await prisma.llmRequest.create({
        data: { organizationId: org.id, agentId: agent.id, model: 'gpt-4o-mini', status: 'reserved', estimatedCostUsd },
      });
      return prisma.approval.create({
        data: { organizationId: org.id, requestId: req.id, reason: 'expensive call', status: 'pending' },
      });
    };

    const cheap = await mkApproval(0.02);
    expect((await classifyCall(tool, { approvalId: cheap.id, decision: 'approve' }, ctx)).risk).toBe('write');

    const pricey = await mkApproval(7.5);
    const verdict = await classifyCall(tool, { approvalId: pricey.id, decision: 'approve' }, ctx);
    expect(verdict.risk).toBe('destructive');
    expect(verdict.reason).toMatch(/\$7\.50/);

    // Denying never needs confirmation: it can only prevent spend.
    expect((await classifyCall(tool, { approvalId: pricey.id, decision: 'deny' }, ctx)).risk).toBe('write');
  });

  it('a classifier cannot de-escalate an always-destructive tool', async () => {
    const { org } = await seedTenant();
    const ctx = { organizationId: org.id, actor: 'test', conversationId: 'c1' };
    // resume_agent is declared destructive; its classifier only supplies a reason.
    const verdict = await classifyCall(getTool('resume_agent')!, { name: 'nobody' }, ctx);
    expect(verdict.risk).toBe('destructive');
  });
});

describe('confirm tokens', () => {
  const payload = { organizationId: 'org1', toolCallId: 'call1', tool: 'delete_budget', args: { name: 'X' } };

  it('round-trips a valid token', () => {
    const { confirmToken } = mintConfirmToken(payload);
    expect(verifyConfirmToken(confirmToken, payload)).toEqual({ valid: true });
  });

  it('rejects a token bound to different arguments, tool, call or tenant', () => {
    const { confirmToken } = mintConfirmToken(payload);
    expect(verifyConfirmToken(confirmToken, { ...payload, args: { name: 'Y' } })).toEqual({
      valid: false,
      reason: 'mismatch',
    });
    expect(verifyConfirmToken(confirmToken, { ...payload, tool: 'update_budget' }).valid).toBe(false);
    expect(verifyConfirmToken(confirmToken, { ...payload, toolCallId: 'call2' }).valid).toBe(false);
    expect(verifyConfirmToken(confirmToken, { ...payload, organizationId: 'org2' }).valid).toBe(false);
  });

  it('rejects expired and malformed tokens', () => {
    const { confirmToken } = mintConfirmToken(payload, Date.now() - 60 * 60 * 1000);
    expect(verifyConfirmToken(confirmToken, payload)).toEqual({ valid: false, reason: 'expired' });
    expect(verifyConfirmToken('garbage', payload)).toEqual({ valid: false, reason: 'malformed' });
    expect(verifyConfirmToken('', payload)).toEqual({ valid: false, reason: 'malformed' });
  });
});

describe('chat turn with the mock provider', () => {
  it('executes a read tool and answers from its result', async () => {
    const { org, agent } = await seedTenant();
    // Give the tenant some spend to report on.
    const req = await prisma.llmRequest.create({
      data: { organizationId: org.id, agentId: agent.id, model: 'gpt-4o-mini', status: 'completed' },
    });
    await prisma.tokenUsage.create({
      data: {
        requestId: req.id,
        organizationId: org.id,
        agentId: agent.id,
        model: 'gpt-4o-mini',
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: 0.00045,
      },
    });

    const res = await chat({ message: 'how much have we spent in total?' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.conversationId).toBeTruthy();
    expect(body.stoppedBecause).toBe('answered');
    expect(body.toolCalls).toHaveLength(1);
    expect(body.toolCalls[0].tool).toBe('get_spend_summary');
    expect(body.toolCalls[0].status).toBe('executed');
    // >= because the assistant's own first turn is metered into the same tenant:
    // its spend shows up in the very report it is running (dogfooding, working).
    expect(body.toolCalls[0].result.totalTokens).toBeGreaterThanOrEqual(1500);
    expect(body.toolCalls[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(body.pendingConfirmations).toHaveLength(0);
    expect(body.reply).toMatch(/totalTokens=\d+/);

    // Two provider turns: the tool call and the answer.
    expect(body.usage.steps.length).toBe(2);
    expect(body.usage.inputTokens).toBeGreaterThan(0);
    expect(body.usage.outputTokens).toBeGreaterThan(0);

    // The transcript is persisted, tenant-scoped, with the tool exchange.
    const convo = (
      await app.inject({
        method: 'GET',
        url: `/v1/assistant/conversations/${body.conversationId}`,
        headers,
      })
    ).json();
    expect(convo.organizationId).toBe(org.id);
    expect(convo.messages.map((m: { role: string }) => m.role)).toContain('tool');
  });

  it('creates a budget end-to-end from natural language', async () => {
    const { org } = await seedTenant();
    const res = await chat({ message: 'create a budget called "Nightly ETL cap" for 250k tokens' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.toolCalls[0].tool).toBe('create_budget');
    expect(body.toolCalls[0].status).toBe('executed');

    const created = await prisma.budget.findFirst({
      where: { organizationId: org.id, name: 'Nightly ETL cap' },
    });
    expect(created).toBeTruthy();
    expect(created!.hardLimit).toBe(250_000);
  });

  it('logs every tool call to the audit log with tenant and actor', async () => {
    const { org } = await seedTenant();
    const body = (await chat({ message: 'which agent costs the most?' })).json();
    const log = await prisma.auditLog.findMany({ where: { organizationId: org.id } });
    const entry = log.find((e) => e.action === 'assistant.tool.get_spend_by_agent');
    expect(entry).toBeTruthy();
    expect(entry!.actor).toMatch(/^apikey:.* via assistant:/);
    expect(entry!.target).toBe(body.toolCalls[0].id);
    const meta = JSON.parse(entry!.metadata!);
    expect(meta.status).toBe('executed');
    expect(meta.risk).toBe('read');
    expect(meta.conversationId).toBe(body.conversationId);
  });

  it('reports a tool error without crashing the turn', async () => {
    await seedTenant();
    const body = (await chat({ message: 'pause the agent named "does-not-exist"' })).json();
    expect(body.toolCalls[0].tool).toBe('pause_agent');
    expect(body.toolCalls[0].status).toBe('error');
    expect(body.toolCalls[0].error).toMatch(/no agent matching/);
    expect(body.stoppedBecause).toBe('answered');
  });

  it('continues an existing conversation', async () => {
    await seedTenant();
    const first = (await chat({ message: 'list our budgets' })).json();
    const second = (
      await chat({ conversationId: first.conversationId, message: 'and the savings ledger?' })
    ).json();
    expect(second.conversationId).toBe(first.conversationId);
    const messages = await prisma.assistantMessage.count({
      where: { conversationId: first.conversationId, role: 'user' },
    });
    expect(messages).toBe(2);
  });
});

describe('destructive tools require a confirm-token round trip', () => {
  it('does not delete a budget until the token comes back', async () => {
    const { org } = await seedTenant();
    const budget = await prisma.budget.create({
      data: { organizationId: org.id, name: 'Legacy cap', level: 'ORGANIZATION', hardLimit: 5_000_000 },
    });

    const first = (await chat({ message: 'delete the budget named "Legacy cap"' })).json();
    expect(first.stoppedBecause).toBe('awaiting_confirmation');
    expect(first.pendingConfirmations).toHaveLength(1);
    const pendingCall = first.pendingConfirmations[0];
    expect(pendingCall.tool).toBe('delete_budget');
    expect(pendingCall.status).toBe('pending_confirmation');
    expect(pendingCall.confirm.reason).toMatch(/permanently deletes budget "Legacy cap"/);
    expect(pendingCall.confirm.confirmToken).toBeTruthy();
    expect(first.reply).toMatch(/Confirm to proceed/);

    // Still there.
    expect(await prisma.budget.findUnique({ where: { id: budget.id } })).toBeTruthy();
    // ...and already visible in the audit log as an intent.
    const pendingAudit = await prisma.auditLog.findFirst({
      where: { organizationId: org.id, action: 'assistant.tool.delete_budget' },
    });
    expect(JSON.parse(pendingAudit!.metadata!).status).toBe('pending_confirmation');

    const confirmed = (
      await chat({
        conversationId: first.conversationId,
        confirmations: [{ toolCallId: pendingCall.id, confirmToken: pendingCall.confirm.confirmToken }],
      })
    ).json();
    expect(confirmed.toolCalls[0].status).toBe('executed');
    expect(await prisma.budget.findUnique({ where: { id: budget.id } })).toBeNull();
  });

  it('rejects a tampered confirmation and leaves the budget alone', async () => {
    const { org } = await seedTenant();
    const keep = await prisma.budget.create({
      data: { organizationId: org.id, name: 'Keep me', level: 'ORGANIZATION', hardLimit: 5_000_000 },
    });
    const first = (await chat({ message: 'delete the budget named "Keep me"' })).json();
    const pendingCall = first.pendingConfirmations[0];

    const res = await chat({
      conversationId: first.conversationId,
      confirmations: [{ toolCallId: pendingCall.id, confirmToken: '9999999999999.deadbeef' }],
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.budget.findUnique({ where: { id: keep.id } })).toBeTruthy();
  });

  it('is single-use: a confirmed call cannot be replayed', async () => {
    const { org } = await seedTenant();
    await prisma.budget.create({
      data: { organizationId: org.id, name: 'Once only', level: 'ORGANIZATION', hardLimit: 5_000_000 },
    });
    const first = (await chat({ message: 'delete the budget named "Once only"' })).json();
    const call = first.pendingConfirmations[0];
    const confirmation = { toolCallId: call.id, confirmToken: call.confirm.confirmToken };

    const ok = (await chat({ conversationId: first.conversationId, confirmations: [confirmation] })).json();
    expect(ok.toolCalls[0].status).toBe('executed');

    const replay = (
      await chat({ conversationId: first.conversationId, confirmations: [confirmation] })
    ).json();
    expect(replay.toolCalls[0].error).toMatch(/already executed/);
  });

  it('an explicit refusal records a denial and does not run the tool', async () => {
    const { org } = await seedTenant();
    const budget = await prisma.budget.create({
      data: { organizationId: org.id, name: 'Safe cap', level: 'ORGANIZATION', hardLimit: 5_000_000 },
    });
    const first = (await chat({ message: 'delete the budget named "Safe cap"' })).json();
    const call = first.pendingConfirmations[0];

    const denied = (
      await chat({
        conversationId: first.conversationId,
        confirmations: [{ toolCallId: call.id, confirmToken: call.confirm.confirmToken, approve: false }],
      })
    ).json();
    expect(denied.toolCalls[0].status).toBe('denied');
    expect(await prisma.budget.findUnique({ where: { id: budget.id } })).toBeTruthy();
    const audits = await prisma.auditLog.findMany({
      where: { organizationId: org.id, action: 'assistant.tool.delete_budget' },
    });
    expect(audits.some((a) => JSON.parse(a.metadata!).status === 'denied')).toBe(true);
  });

  it('gates raising a hard limit but not lowering it', async () => {
    const { org } = await seedTenant();
    const budget = await prisma.budget.create({
      data: { organizationId: org.id, name: 'Org cap', level: 'ORGANIZATION', hardLimit: 1_000_000 },
    });

    const lower = (await chat({ message: 'lower the budget "Org cap" limit to 500000' })).json();
    expect(lower.stoppedBecause).toBe('answered');
    expect(lower.toolCalls[0].tool).toBe('update_budget');
    expect(lower.toolCalls[0].status).toBe('executed');
    expect((await prisma.budget.findUnique({ where: { id: budget.id } }))!.hardLimit).toBe(500_000);

    const raise = (await chat({ message: 'raise the budget "Org cap" limit to 2000000' })).json();
    expect(raise.stoppedBecause).toBe('awaiting_confirmation');
    expect(raise.pendingConfirmations[0].confirm.reason).toMatch(/raises the hard limit/);
    expect((await prisma.budget.findUnique({ where: { id: budget.id } }))!.hardLimit).toBe(500_000);
  });

  it('gates a bulk policy-pack import', async () => {
    await seedTenant();
    const res = (await chat({ message: 'import the "support-desk-pack" policy pack' })).json();
    expect(res.stoppedBecause).toBe('awaiting_confirmation');
    expect(res.pendingConfirmations[0].tool).toBe('import_policy_pack');
    expect(res.pendingConfirmations[0].confirm.reason).toMatch(/creates \d+ budget/);
  });
});

describe('dogfooding: the assistant is metered by the product it runs in', () => {
  it('records its own spend under the tbm-assistant agent', async () => {
    const { org } = await seedTenant();
    await chat({ message: 'how much have we spent?' });

    const identity = await ensureAssistantIdentity(org.id);
    const agent = await prisma.agent.findUnique({ where: { id: identity.agentId } });
    expect(agent!.name).toBe(ASSISTANT_AGENT);

    const usage = await prisma.tokenUsage.aggregate({
      where: { organizationId: org.id, agentId: identity.agentId },
      _sum: { totalTokens: true, costUsd: true },
      _count: true,
    });
    expect(usage._count).toBe(2); // one provider turn per step
    expect(usage._sum.totalTokens ?? 0).toBeGreaterThan(0);

    // Visible through the ordinary analytics the dashboard already uses.
    const byAgent = (await app.inject({ method: 'GET', url: '/v1/analytics/by-agent', headers })).json();
    const row = byAgent.find((r: { agentId: string }) => r.agentId === identity.agentId);
    expect(row.agentName).toBe(ASSISTANT_AGENT);
    expect(row.totalTokens).toBeGreaterThan(0);

    // And through the assistant's own spend endpoint.
    const spend = (await app.inject({ method: 'GET', url: '/v1/assistant/spend', headers })).json();
    expect(spend.agent).toBe(ASSISTANT_AGENT);
    expect(spend.totalTokens).toBe(usage._sum.totalTokens);
    expect(spend.budget.name).toBe('Assistant monthly tokens');
    expect(spend.budget.utilization).toBeGreaterThan(0);
  });

  it('gets a default budget that can block it like any other agent', async () => {
    const { org } = await seedTenant();
    const identity = await ensureAssistantIdentity(org.id);

    // Squeeze the assistant's own budget to almost nothing.
    await prisma.budget.update({
      where: { id: identity.budgetId },
      data: { hardLimit: 50, softLimit: null, resetPeriod: 'NEVER' },
    });

    const body = (await chat({ message: 'how much have we spent?' })).json();
    expect(body.stoppedBecause).toBe('budget_blocked');
    expect(body.blocked.reason).toMatch(/hard limit/i);
    expect(body.blocked.budgets[0].name).toBe('Assistant monthly tokens');
    expect(body.reply).toMatch(/my own budget blocked me/);
    expect(body.toolCalls).toHaveLength(0);

    // The blocked attempt is still accounted, like any blocked request.
    const blockedCount = await prisma.llmRequest.count({
      where: { organizationId: org.id, agentId: identity.agentId, status: 'blocked' },
    });
    expect(blockedCount).toBeGreaterThan(0);
  });

  it('stops when its agent identity is paused', async () => {
    const { org } = await seedTenant();
    const identity = await ensureAssistantIdentity(org.id);
    await prisma.agent.update({ where: { id: identity.agentId }, data: { status: 'paused' } });

    const body = (await chat({ message: 'list our budgets' })).json();
    expect(body.stoppedBecause).toBe('budget_blocked');
    expect(body.blocked.reason).toMatch(/paused/);
  });
});

describe('assistant HTTP surface', () => {
  it('describes its tools and confirmation classes', async () => {
    await seedTenant();
    const res = (await app.inject({ method: 'GET', url: '/v1/assistant/tools', headers })).json();
    expect(res.provider).toBe('mock');
    expect(res.alwaysConfirm).toContain('delete_budget');
    expect(res.conditionallyConfirm).toContain('update_budget');
    const del = res.tools.find((t: { name: string }) => t.name === 'delete_budget');
    expect(del.confirmation).toBe('always');
    const read = res.tools.find((t: { name: string }) => t.name === 'get_spend_summary');
    expect(read.confirmation).toBe('never');
  });

  it('streams a turn as SSE events ending in done', async () => {
    await seedTenant();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/assistant/chat/stream',
      headers,
      payload: { message: 'which agent costs the most?' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = res.payload
      .split('\n\n')
      .filter(Boolean)
      .map((chunk) => chunk.split('\n')[0].replace('event: ', ''));
    expect(events).toContain('conversation');
    expect(events).toContain('tool_call');
    expect(events).toContain('tool_result');
    expect(events).toContain('usage');
    expect(events).toContain('done');
    expect(events.at(-1)).toBe('end');
  });

  it('scopes conversations per tenant', async () => {
    await seedTenant();
    const mine = (await chat({ message: 'list our budgets' })).json();

    const other = await prisma.organization.create({ data: { name: 'Other' } });
    await prisma.apiKey.create({
      data: { organizationId: other.id, name: 'k2', keyHash: hashApiKey('tbm_other_key'), role: 'owner' },
    });
    const otherHeaders = { 'x-api-key': 'tbm_other_key', 'content-type': 'application/json' };

    const list = (
      await app.inject({ method: 'GET', url: '/v1/assistant/conversations', headers: otherHeaders })
    ).json();
    expect(list).toHaveLength(0);

    const peek = await app.inject({
      method: 'GET',
      url: `/v1/assistant/conversations/${mine.conversationId}`,
      headers: otherHeaders,
    });
    expect(peek.statusCode).toBe(404);

    const hijack = await app.inject({
      method: 'POST',
      url: '/v1/assistant/chat',
      headers: otherHeaders,
      payload: { conversationId: mine.conversationId, message: 'tell me their spend' },
    });
    expect(hijack.statusCode).toBe(404);
  });

  it('requires at least a member role', async () => {
    const org = await prisma.organization.create({ data: { name: 'Viewer Org' } });
    await prisma.apiKey.create({
      data: { organizationId: org.id, name: 'v', keyHash: hashApiKey('tbm_viewer_key'), role: 'viewer' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/assistant/chat',
      headers: { 'x-api-key': 'tbm_viewer_key', 'content-type': 'application/json' },
      payload: { message: 'how much have we spent?' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an empty turn', async () => {
    await seedTenant();
    const res = await chat({});
    expect(res.statusCode).toBe(400);
  });
});
