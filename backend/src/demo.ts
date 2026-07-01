import { prisma } from './db.js';
import { buildServer } from './server.js';
import { seed, DEMO_API_KEY } from './seed.js';

/** Wipe all tables so the demo is repeatable. Order respects FKs. */
async function resetDb() {
  await prisma.tokenUsage.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.policyEvent.deleteMany();
  await prisma.llmRequest.deleteMany();
  await prisma.budgetPolicy.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.task.deleteMany();
  await prisma.session.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.project.deleteMany();
  await prisma.modelPricing.deleteMany();
  await prisma.providerKey.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.user.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.organization.deleteMany();
}

const line = (s = '') => console.log(s);
const H = (s: string) => console.log(`\n=== ${s} ===`);

async function main() {
  H('Setup: reset + seed');
  await resetDb();
  const { agent, session, task } = await seed();
  line(`agent=${agent.id} session=${session.id} task=${task.id}`);

  const app = await buildServer();
  const headers = { 'x-api-key': DEMO_API_KEY, 'content-type': 'application/json' };
  const scope = { agentId: agent.id, sessionId: session.id, taskId: task.id, projectId: undefined as any };
  const post = async (url: string, payload: unknown): Promise<any> =>
    app.inject({ method: 'POST', url, headers, payload: payload as any });
  const get = async (url: string): Promise<any> => app.inject({ method: 'GET', url, headers });

  H('1) Pre-request check (forecast + decision + reservation)');
  const check = await post('/v1/check-budget', {
    model: 'gpt-4o-mini',
    provider: 'mock',
    messages: [
      { role: 'system', content: 'You are a helpful triage assistant.' },
      { role: 'user', content: 'Classify this support ticket: my charger station is offline.' },
    ],
    expectedCompletionTokens: 64,
    scope,
  });
  const checkBody = check.json();
  line(`decision=${checkBody.decision} allowed=${checkBody.allowed}`);
  line(`forecast: prompt=${checkBody.forecast.promptTokens} reserved=${checkBody.forecast.reservedTokens} estCost=$${checkBody.forecast.estimatedCostUsd}`);

  H('2) End-to-end call via mock provider (check -> call -> record)');
  const complete = await post('/v1/llm/complete', {
    model: 'gpt-4o-mini',
    provider: 'mock',
    messages: [
      { role: 'system', content: 'You are a helpful triage assistant.' },
      { role: 'user', content: 'Classify this support ticket: my charger station is offline.' },
    ],
    maxTokens: 64,
    scope,
  });
  const completeBody = complete.json();
  line(`status=${complete.statusCode} content="${completeBody.content}"`);
  line(`actual usage: input=${completeBody.usage.inputTokens} output=${completeBody.usage.outputTokens} total=${completeBody.usage.totalTokens} cost=$${completeBody.usage.costUsd}`);

  H('3) Analytics reflect the call');
  const total = (await get('/v1/analytics/total')).json();
  line(`total tokens=${total.totalTokens} cost=$${total.costUsd} requests=${total.requests}`);
  const byAgent = (await get('/v1/analytics/by-agent')).json();
  line(`by-agent: ${JSON.stringify(byAgent)}`);

  H('4) Useless-loop detection (same prompt repeated)');
  const loopSession = await prisma.session.create({ data: { agentId: agent.id, label: 'loop session' } });
  const loopScope = { agentId: agent.id, sessionId: loopSession.id };
  let loopBlocked = false;
  for (let i = 0; i < 5; i++) {
    const r = await post('/v1/check-budget', {
      model: 'gpt-4o-mini',
      provider: 'mock',
      messages: [{ role: 'user', content: 'Retry the exact same request with no changes.' }],
      expectedCompletionTokens: 16,
      scope: loopScope,
    });
    const b = r.json();
    line(`  loop attempt #${i}: decision=${b.decision} repeats=${b.signals.signatureRepeats}`);
    if (b.decision === 'stop-agent' && !b.allowed) {
      loopBlocked = true;
      break;
    }
  }
  line(loopBlocked ? 'PASS: useless loop stopped.' : 'NOTE: loop threshold not reached in demo iterations.');

  H('5) Hard-limit enforcement (agent cap = 5000 tokens/day)');
  let blockedAt = -1;
  for (let i = 0; i < 80; i++) {
    const r = await post('/v1/llm/complete', {
      model: 'gpt-4o-mini',
      provider: 'mock',
      messages: [
        { role: 'system', content: 'You are a helpful triage assistant.' },
        { role: 'user', content: `Ticket #${i}: charger ${i} shows error code E${i}${i}. Diagnose in detail please.` },
      ],
      maxTokens: 64,
      scope,
    });
    if (r.statusCode === 402) {
      blockedAt = i;
      line(`call #${i} BLOCKED: ${r.json().reason}`);
      break;
    }
  }
  const afterAgent = (await get('/v1/analytics/by-agent')).json();
  const agentTokens = afterAgent.find((a: any) => a.agentId === agent.id)?.totalTokens ?? 0;
  line(`agent recorded tokens=${agentTokens} (hard limit 5000) blocked at call #${blockedAt}`);
  line(agentTokens <= 5000 ? 'PASS: agent did not exceed hard token budget.' : 'FAIL: exceeded hard budget!');

  H('6) Recommendations');
  const recs = (await get('/v1/analytics/recommendations')).json();
  for (const r of recs) line(`  [${r.severity}] ${r.type}: ${r.message}`);

  await app.close();
  await prisma.$disconnect();
  line('\nDemo complete.');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
