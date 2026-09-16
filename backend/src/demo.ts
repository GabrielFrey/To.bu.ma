import { prisma } from './db.js';
import { buildServer } from './server.js';
import { resetDatabase } from './reset.js';
import { seed, DEMO_API_KEY } from './seed.js';

// The demo output is the deliverable here; request logs would drown it.
process.env.LOG_LEVEL ??= 'silent';

const line = (s = '') => console.log(s);
const H = (s: string) => console.log(`\n=== ${s} ===`);

async function main() {
  H('Setup: reset + seed');
  await resetDatabase();
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

  H('7) FLAGSHIP: Run-level predictive overflow forecast');
  const forecast = await post('/v1/forecast/run', {
    model: 'gpt-4o-mini',
    estimatedSteps: 25,
    avgPromptTokens: 600,
    avgCompletionTokens: 200,
    toolCallsPerStep: 1,
    avgToolTokens: 40,
    scope,
  });
  const fc = forecast.json();
  line(`projected run: ${fc.projectedRunTokens} tokens / $${fc.projectedRunCostUsd} over ${fc.estimatedSteps} steps`);
  line(`willExceed=${fc.willExceedHardLimit} stepsUntilLimit=${fc.stepsUntilHardLimit} recommendation=${fc.recommendation}`);
  line(`reason: ${fc.reason}`);
  if (fc.limitingBudget) line(`limiting budget: "${fc.limitingBudget.name}" (${fc.limitingBudget.level})`);

  H('8) FLAGSHIP: Savings ledger (counterfactual ROI)');
  const ledger = (await get('/v1/analytics/savings-ledger')).json();
  line(`total saved (est): $${ledger.totalSavedUsd} / ${ledger.totalSavedTokens} tokens`);
  line(`blocked=${ledger.blockedRequests} optimized=${ledger.optimizedRequests}`);
  for (const row of ledger.byDecision ?? []) {
    line(`  ${row.decision}: ${row.count} events, saved $${row.savedUsd}`);
  }

  H('9) Policy simulation dry-run (loop stop policy)');
  const sim = await post('/v1/policies/simulate', {
    hypotheticalPolicies: [{ name: 'sim loop stop', condition: 'loop', action: 'STOP_AGENT', priority: 10 }],
    lookbackHours: 24,
    sampleLimit: 200,
  });
  const simBody = sim.json();
  line(`sample=${simBody.sampleSize} wouldBlock=${simBody.wouldBlock} projectedSavings=$${simBody.projectedSavingsUsd}`);

  H('10) AI ASSISTANT: answers, acts, and pays for itself (offline mock provider)');
  const tools = (await get('/v1/assistant/tools')).json();
  line(`provider=${tools.provider} model=${tools.model} tools=${tools.tools.length}`);
  line(`always confirm: ${tools.alwaysConfirm.join(', ')}`);
  line(`conditionally confirm: ${tools.conditionallyConfirm.join(', ')}`);

  line('\n-- 10a) Ask a question: the assistant calls a read tool and answers');
  const ask = (await post('/v1/assistant/chat', { message: 'how much have we spent in total?' })).json();
  for (const call of ask.toolCalls) {
    line(`  tool ${call.tool} [${call.risk}] ${call.status} in ${call.durationMs}ms — ${call.summary}`);
  }
  line(`  reply: ${ask.reply}`);
  line(`  assistant's own cost this turn: ${ask.usage.inputTokens} in / ${ask.usage.outputTokens} out / $${ask.usage.costUsd}`);

  line('\n-- 10b) Low-risk write: create a budget from natural language (runs directly)');
  const create = (
    await post('/v1/assistant/chat', {
      message: 'create a budget called "Assistant demo cap" for 120k tokens',
    })
  ).json();
  for (const call of create.toolCalls) line(`  tool ${call.tool} [${call.risk}] ${call.status} — ${call.summary}`);
  line(`  reply: ${create.reply}`);

  line('\n-- 10c) Destructive write: deleting a budget stops for confirmation');
  const gated = (await post('/v1/assistant/chat', { message: 'delete the budget named "Assistant demo cap"' })).json();
  line(`  stoppedBecause=${gated.stoppedBecause}`);
  for (const p of gated.pendingConfirmations) {
    line(`  GATED ${p.tool}: ${p.confirm.reason}`);
    line(`    confirm token expires ${p.confirm.expiresAt}`);
  }
  const stillThere = await prisma.budget.count({ where: { name: 'Assistant demo cap' } });
  line(`  budget still present before confirmation: ${stillThere === 1 ? 'YES (correct)' : 'NO (bug!)'}`);

  line('\n-- 10d) Confirm-token round trip: the same call now executes');
  const pending = gated.pendingConfirmations[0];
  const confirmed = (
    await post('/v1/assistant/chat', {
      conversationId: gated.conversationId,
      confirmations: [{ toolCallId: pending.id, confirmToken: pending.confirm.confirmToken }],
    })
  ).json();
  for (const call of confirmed.toolCalls) line(`  tool ${call.tool} ${call.status} — ${JSON.stringify(call.result)}`);
  const afterDelete = await prisma.budget.count({ where: { name: 'Assistant demo cap' } });
  line(`  budget deleted after confirmation: ${afterDelete === 0 ? 'YES (correct)' : 'NO (bug!)'}`);

  line('\n-- 10e) A tampered token is refused');
  await post('/v1/assistant/chat', { message: 'delete the budget named "Org monthly tokens"' }).then(async (r) => {
    const p = r.json().pendingConfirmations?.[0];
    if (!p) return;
    const bad = await post('/v1/assistant/chat', {
      conversationId: r.json().conversationId,
      confirmations: [{ toolCallId: p.id, confirmToken: '9999999999999.deadbeefdeadbeef' }],
    });
    line(`  tampered confirmation → HTTP ${bad.statusCode} (expected 400)`);
  });

  line('\n-- 10f) DOGFOODING: the assistant\'s own spend is budgeted and visible');
  const spend = (await get('/v1/assistant/spend')).json();
  line(`  agent=${spend.agent} requests=${spend.requests} tokens=${spend.totalTokens} cost=$${spend.costUsd}`);
  line(`  own budget "${spend.budget.name}": ${spend.totalTokens}/${spend.budget.hardLimit} ` +
    `(${(spend.budget.utilization * 100).toFixed(2)}% used, resets ${spend.budget.resetPeriod})`);
  const assistantRow = (await get('/v1/analytics/by-agent')).json().find((a: any) => a.agentName === 'tbm-assistant');
  line(`  same spend via /v1/analytics/by-agent: ${assistantRow ? `${assistantRow.totalTokens} tokens, $${assistantRow.costUsd}` : 'MISSING (bug!)'}`);

  line('\n-- 10g) The product can block its own assistant');
  await prisma.budget.update({
    where: { id: spend.budget.id },
    data: { hardLimit: 10, resetPeriod: 'NEVER', softLimit: null },
  });
  const blocked = (await post('/v1/assistant/chat', { message: 'how much have we spent?' })).json();
  line(`  stoppedBecause=${blocked.stoppedBecause} decision=${blocked.blocked?.decision}`);
  line(`  reply: ${blocked.reply}`);
  line(blocked.stoppedBecause === 'budget_blocked' ? '  PASS: the assistant is subject to its own product.' : '  FAIL: assistant escaped its budget!');
  // Leave the seeded database usable: the dashboard's assistant tab is the next
  // thing anyone opens after running the demo.
  await prisma.budget.update({
    where: { id: spend.budget.id },
    data: { hardLimit: 200_000, resetPeriod: 'MONTHLY', softLimit: 160_000 },
  });
  line('  (budget restored so the dashboard demo still works)');

  line('\n-- 10h) Every tool call is in the audit log with tenant + actor');
  const auditLog = (await get('/v1/audit-log')).json();
  const toolAudits = auditLog.filter((e: any) => e.action.startsWith('assistant.tool.'));
  line(`  ${toolAudits.length} assistant tool-call audit entries`);
  for (const e of toolAudits.slice(0, 6)) {
    const meta = JSON.parse(e.metadata ?? '{}');
    line(`    ${e.action} status=${meta.status} risk=${meta.risk ?? '-'} actor=${e.actor}`);
  }

  await app.close();
  await prisma.$disconnect();
  line('\nDemo complete.');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
