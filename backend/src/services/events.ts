import { createHmac } from 'node:crypto';
import { prisma } from '../db.js';
import { config } from '../config.js';

export const EVENT_TYPES = [
  'soft_limit_crossed',
  'warning_threshold',
  'hard_limit_blocked',
  'approval_required',
  'approval_resolved',
  'loop_stopped',
  'agent_paused',
  'agent_resumed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** HMAC-SHA256 signature of a raw JSON body, formatted like GitHub/Stripe. */
export function signPayload(secret: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifySignature(secret: string, rawBody: string, signature: string): boolean {
  const expected = signPayload(secret, rawBody);
  // Constant-time-ish compare (lengths equal for same algo).
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/** Signed, URL-safe token so an approval can be resolved from an email/Slack link. */
export function approvalActionToken(approvalId: string, action: 'approve' | 'deny'): string {
  return createHmac('sha256', config.masterKey).update(`${approvalId}:${action}`).digest('hex').slice(0, 32);
}
export function verifyApprovalActionToken(approvalId: string, action: 'approve' | 'deny', token: string): boolean {
  return approvalActionToken(approvalId, action) === token;
}

function eventMatches(subscription: string, type: string): boolean {
  if (subscription.trim() === 'all') return true;
  return subscription.split(',').map((s) => s.trim()).includes(type);
}

function formatEventText(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case 'warning_threshold':
      return `⚠️ Budget warning: "${data.budgetName}" at ${Math.round(Number(data.utilization) * 100)}% utilization.`;
    case 'soft_limit_crossed':
      return `🟠 Soft limit crossed on "${data.budgetName}" — requests are being degraded/compressed.`;
    case 'hard_limit_blocked':
      return `⛔ Hard limit reached on "${data.budgetName}" — request BLOCKED. ${data.reason ?? ''}`;
    case 'approval_required':
      return `🔐 Approval required: ${data.reason}. Approve: ${data.approveUrl} | Deny: ${data.denyUrl}`;
    case 'approval_resolved':
      return `✅ Approval ${data.status}: ${data.reason ?? ''}`;
    case 'loop_stopped':
      return `🔁 Useless loop stopped: ${data.reason}`;
    case 'agent_paused':
      return `⏸️ Agent paused (${data.agentId}).`;
    case 'agent_resumed':
      return `▶️ Agent resumed (${data.agentId}).`;
    default:
      return `TBM event: ${type}`;
  }
}

// Track in-flight first-attempt deliveries so tests can await them deterministically.
const inFlight = new Set<Promise<unknown>>();
export async function drainDeliveries(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

/**
 * Emit an event: persist it, then fan out to every active, subscribed webhook /
 * notification channel with signed payloads and retry-with-backoff delivery.
 * Never throws to the caller (delivery is best-effort / async).
 */
export async function emitEvent(params: {
  organizationId: string;
  type: EventType;
  data: Record<string, unknown>;
}): Promise<{ eventId: string; deliveryIds: string[] }> {
  const { organizationId, type, data } = params;
  const event = await prisma.eventLog.create({
    data: { organizationId, type, payload: JSON.stringify(data) },
  });

  const webhooks = await prisma.webhook.findMany({ where: { organizationId, active: true } });
  const targets = webhooks.filter((w) => eventMatches(w.events, type));

  const deliveryIds: string[] = [];
  for (const w of targets) {
    const bodyObj = { id: event.id, type, createdAt: event.createdAt.toISOString(), data };
    const delivery = await prisma.webhookDelivery.create({
      data: {
        webhookId: w.id,
        organizationId,
        event: type,
        payload: JSON.stringify(bodyObj),
        status: 'pending',
      },
    });
    deliveryIds.push(delivery.id);
    const p = dispatchDelivery(delivery.id).finally(() => inFlight.delete(p));
    inFlight.add(p);
  }
  return { eventId: event.id, deliveryIds };
}

/** Attempt a single delivery; on failure, schedule a backoff retry. */
export async function dispatchDelivery(deliveryId: string): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery || delivery.status === 'success') return;
  const webhook = await prisma.webhook.findUnique({ where: { id: delivery.webhookId } });
  if (!webhook || !webhook.active) return;

  const attempt = delivery.attempts + 1;
  try {
    await sendToChannel(webhook, delivery.event, delivery.payload);
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'success', attempts: attempt, deliveredAt: new Date(), responseStatus: 200, nextAttemptAt: null },
    });
  } catch (err) {
    const failedPermanently = attempt >= config.webhookMaxAttempts;
    const backoff = config.webhookBackoffMs * Math.pow(2, attempt - 1);
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: failedPermanently ? 'failed' : 'pending',
        attempts: attempt,
        lastError: (err as Error).message.slice(0, 500),
        nextAttemptAt: failedPermanently ? null : new Date(Date.now() + backoff),
      },
    });
    if (!failedPermanently) {
      const t = setTimeout(() => void dispatchDelivery(deliveryId), backoff);
      // Do not keep the process alive solely for a retry timer.
      if (typeof t.unref === 'function') t.unref();
    }
  }
}

async function sendToChannel(
  webhook: { kind: string; url: string | null; target: string | null; secret: string },
  eventType: string,
  rawBody: string
): Promise<void> {
  const data = JSON.parse(rawBody).data ?? {};

  if (webhook.kind === 'email') {
    await sendEmail(webhook.target ?? '', `TBM: ${eventType}`, formatEventText(eventType, data));
    return;
  }

  if (webhook.kind === 'slack') {
    await postJson(webhook.url!, { text: formatEventText(eventType, data) }, { 'x-tbm-event': eventType });
    return;
  }

  // generic / http: signed JSON envelope.
  const signature = signPayload(webhook.secret, rawBody);
  await postJson(webhook.url!, JSON.parse(rawBody), {
    'x-tbm-event': eventType,
    'x-tbm-signature': signature,
  });
}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.webhookTimeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`delivery failed with status ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Email adapter. MVP is a documented stub: it logs the message. To send real
 * email, set SMTP_URL and swap this for a nodemailer transport (see README).
 */
async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!to) throw new Error('email channel has no target address');
  // eslint-disable-next-line no-console
  console.log(`[email:stub] to=${to} subject="${subject}" body="${text}"`);
}

/** Build actionable approval links for a pending approval. */
export function approvalLinks(approvalId: string): { approveUrl: string; denyUrl: string } {
  const base = `${config.publicUrl}/v1/approvals/${approvalId}/resolve`;
  return {
    approveUrl: `${base}?action=approve&token=${approvalActionToken(approvalId, 'approve')}`,
    denyUrl: `${base}?action=deny&token=${approvalActionToken(approvalId, 'deny')}`,
  };
}
