import { prisma } from './db.js';
import { hashApiKey, encryptSecret } from './crypto.js';
import { config } from './config.js';

/** Deterministic demo API key so the dashboard/demo/tests can authenticate. */
export const DEMO_API_KEY = 'tbm_demo_local_key';

const PRICING: Array<{
  model: string;
  inputPerMTokens: number;
  outputPerMTokens: number;
  cachedPerMTokens: number;
  contextWindow: number;
}> = [
  { model: 'gpt-4o', inputPerMTokens: 2.5, outputPerMTokens: 10, cachedPerMTokens: 1.25, contextWindow: 128000 },
  { model: 'gpt-4o-mini', inputPerMTokens: 0.15, outputPerMTokens: 0.6, cachedPerMTokens: 0.075, contextWindow: 128000 },
  { model: 'gpt-4.1', inputPerMTokens: 2.0, outputPerMTokens: 8, cachedPerMTokens: 0.5, contextWindow: 1000000 },
  { model: 'gpt-4.1-mini', inputPerMTokens: 0.4, outputPerMTokens: 1.6, cachedPerMTokens: 0.1, contextWindow: 1000000 },
  { model: 'gpt-3.5-turbo', inputPerMTokens: 0.5, outputPerMTokens: 1.5, cachedPerMTokens: 0, contextWindow: 16385 },
];

/** Wipe all tables so seeding is repeatable. Order respects FKs. */
export async function resetAll() {
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

export async function seed() {
  const org = await prisma.organization.create({ data: { name: 'Demo Org' } });

  await prisma.user.create({
    data: { organizationId: org.id, email: 'owner@demo.local', name: 'Demo Owner', role: 'owner' },
  });

  await prisma.apiKey.create({
    data: {
      organizationId: org.id,
      name: 'demo key',
      keyHash: hashApiKey(DEMO_API_KEY),
      role: 'owner',
    },
  });

  // Store a (placeholder) provider key encrypted at rest so the openai path works
  // when a real key is provided via env at seed time.
  if (config.openaiApiKey) {
    await prisma.providerKey.create({
      data: {
        organizationId: org.id,
        provider: 'openai',
        label: 'default',
        ciphertext: encryptSecret(config.openaiApiKey),
      },
    });
  }

  const project = await prisma.project.create({ data: { organizationId: org.id, name: 'Support Bot' } });
  const agent = await prisma.agent.create({ data: { projectId: project.id, name: 'Triage Agent' } });
  const session = await prisma.session.create({ data: { agentId: agent.id, label: 'demo session' } });
  const task = await prisma.task.create({ data: { sessionId: session.id, name: 'classify ticket', priority: 7 } });

  for (const p of PRICING) {
    await prisma.modelPricing.create({
      data: { provider: 'openai', organizationId: null, ...p },
    });
  }

  // Budgets across levels.
  const orgBudget = await prisma.budget.create({
    data: {
      organizationId: org.id,
      name: 'Org monthly tokens',
      level: 'ORGANIZATION',
      metric: 'TOKENS',
      hardLimit: 1_000_000,
      softLimit: 800_000,
      warningThreshold: 0.8,
      resetPeriod: 'MONTHLY',
      priority: 10,
      fallbackBehavior: 'BLOCK',
    },
  });

  const agentBudget = await prisma.budget.create({
    data: {
      organizationId: org.id,
      name: 'Triage Agent cap',
      level: 'AGENT',
      scopeId: agent.id,
      metric: 'TOKENS',
      hardLimit: 5000,
      softLimit: 3500,
      warningThreshold: 0.7,
      resetPeriod: 'DAILY',
      priority: 5,
      fallbackBehavior: 'BLOCK',
    },
  });

  await prisma.budget.create({
    data: {
      organizationId: org.id,
      name: 'Per-request cost guard',
      level: 'REQUEST',
      metric: 'COST_USD',
      hardLimit: 1.0,
      softLimit: 0.5,
      warningThreshold: 0.8,
      resetPeriod: 'NEVER',
      priority: 5,
      fallbackBehavior: 'REQUIRE_APPROVAL',
    },
  });

  // Policies.
  await prisma.budgetPolicy.create({
    data: { budgetId: orgBudget.id, name: 'warn at 80%', condition: 'utilization>=0.8', action: 'WARN', priority: 5 },
  });
  await prisma.budgetPolicy.create({
    data: { budgetId: agentBudget.id, name: 'compress near soft', condition: 'utilization>=0.7', action: 'COMPRESS', priority: 6 },
  });
  await prisma.budgetPolicy.create({
    data: { budgetId: agentBudget.id, name: 'stop useless loops', condition: 'loop', action: 'STOP_AGENT', priority: 9 },
  });
  await prisma.budgetPolicy.create({
    data: { budgetId: agentBudget.id, name: 'retry cap', condition: 'retries>=3', action: 'RETRY_LIMIT', priority: 9 },
  });

  return { org, project, agent, session, task, orgBudget, agentBudget };
}

// Run directly.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  resetAll()
    .then(() => seed())
    .then((r) => {
      console.log('Seeded demo data.');
      console.log('  organizationId:', r.org.id);
      console.log('  projectId:     ', r.project.id);
      console.log('  agentId:       ', r.agent.id);
      console.log('  sessionId:     ', r.session.id);
      console.log('  taskId:        ', r.task.id);
      console.log('  API key:       ', DEMO_API_KEY);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
