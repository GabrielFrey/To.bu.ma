import { prisma } from './db.js';

/**
 * Single source of truth for wiping every table, in foreign-key-safe order.
 * The seed script, the demo script and the test helpers all call this, so adding
 * a model means editing exactly one list.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.assistantToolCall.deleteMany();
  await prisma.assistantMessage.deleteMany();
  await prisma.assistantConversation.deleteMany();
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
