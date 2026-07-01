import { prisma } from '../src/db.js';

export async function resetDb() {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhook.deleteMany();
  await prisma.eventLog.deleteMany();
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

export async function makeOrgScope() {
  const org = await prisma.organization.create({ data: { name: 'Test Org' } });
  const project = await prisma.project.create({ data: { organizationId: org.id, name: 'P' } });
  const agent = await prisma.agent.create({ data: { projectId: project.id, name: 'A' } });
  const session = await prisma.session.create({ data: { agentId: agent.id } });
  const task = await prisma.task.create({ data: { sessionId: session.id, name: 'T' } });
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
  return {
    org,
    project,
    agent,
    session,
    task,
    chain: {
      organizationId: org.id,
      projectId: project.id,
      agentId: agent.id,
      sessionId: session.id,
      taskId: task.id,
    },
  };
}
