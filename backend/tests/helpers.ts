import { prisma } from '../src/db.js';
import { resetDatabase } from '../src/reset.js';

export const resetDb = resetDatabase;

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
