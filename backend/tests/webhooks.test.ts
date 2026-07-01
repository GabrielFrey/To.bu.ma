import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { prisma } from '../src/db.js';
import { resetDb } from './helpers.js';
import {
  emitEvent, drainDeliveries, signPayload, verifySignature,
  approvalActionToken, verifyApprovalActionToken,
} from '../src/services/events.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function makeOrg() {
  return prisma.organization.create({ data: { name: 'WH Org' } });
}

/** Spin up a throwaway HTTP receiver; resolves captured requests. */
function receiver(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      handler(req, body, res);
    });
  });
  return new Promise<{ url: string; received: typeof received; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, received, close: () => server.close() });
    });
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function pollDelivery(id: string, status: string, timeoutMs = 2000) {
  const start = Date.now();
  for (;;) {
    const d = await prisma.webhookDelivery.findUnique({ where: { id } });
    if (d && d.status === status) return d;
    if (Date.now() - start > timeoutMs) return d;
    await wait(15);
  }
}

describe('HMAC signing', () => {
  it('signs and verifies a payload', () => {
    const sig = signPayload('secret', '{"a":1}');
    expect(sig.startsWith('sha256=')).toBe(true);
    expect(verifySignature('secret', '{"a":1}', sig)).toBe(true);
    expect(verifySignature('secret', '{"a":2}', sig)).toBe(false);
    expect(verifySignature('wrong', '{"a":1}', sig)).toBe(false);
  });

  it('approval action tokens verify', () => {
    const t = approvalActionToken('appr1', 'approve');
    expect(verifyApprovalActionToken('appr1', 'approve', t)).toBe(true);
    expect(verifyApprovalActionToken('appr1', 'deny', t)).toBe(false);
    expect(verifyApprovalActionToken('appr2', 'approve', t)).toBe(false);
  });
});

describe('event emission + delivery', () => {
  it('records an EventLog and only delivers to subscribed webhooks', async () => {
    const org = await makeOrg();
    const srv = await receiver((_r, _b, res) => res.writeHead(200).end('ok'));
    try {
      await prisma.webhook.create({
        data: { organizationId: org.id, kind: 'generic', url: srv.url, secret: 's1', events: 'hard_limit_blocked' },
      });
      await prisma.webhook.create({
        data: { organizationId: org.id, kind: 'generic', url: srv.url, secret: 's2', events: 'warning_threshold' },
      });

      const res = await emitEvent({ organizationId: org.id, type: 'warning_threshold', data: { budgetName: 'b' } });
      await drainDeliveries();

      const log = await prisma.eventLog.findMany({ where: { organizationId: org.id } });
      expect(log).toHaveLength(1);
      // Only the warning-subscribed webhook got a delivery.
      expect(res.deliveryIds).toHaveLength(1);
      const d = await pollDelivery(res.deliveryIds[0], 'success');
      expect(d?.status).toBe('success');
    } finally {
      srv.close();
    }
  });

  it('delivers a signed payload the receiver can verify', async () => {
    const org = await makeOrg();
    const secret = 'topsecret';
    let sigValid = false;
    const srv = await receiver((req, body, res) => {
      const sig = req.headers['x-tbm-signature'] as string;
      sigValid = verifySignature(secret, body, sig);
      res.writeHead(200).end('ok');
    });
    try {
      await prisma.webhook.create({
        data: { organizationId: org.id, kind: 'generic', url: srv.url, secret, events: 'all' },
      });
      const res = await emitEvent({ organizationId: org.id, type: 'hard_limit_blocked', data: { budgetName: 'b', reason: 'over' } });
      await drainDeliveries();
      await pollDelivery(res.deliveryIds[0], 'success');
      expect(srv.received.length).toBeGreaterThanOrEqual(1);
      expect(sigValid).toBe(true);
      const payload = JSON.parse(srv.received[0].body);
      expect(payload.type).toBe('hard_limit_blocked');
      expect(payload.data.budgetName).toBe('b');
    } finally {
      srv.close();
    }
  });

  it('retries with backoff and eventually succeeds', async () => {
    const org = await makeOrg();
    let hits = 0;
    const srv = await receiver((_req, _body, res) => {
      hits += 1;
      if (hits < 3) res.writeHead(500).end('fail');
      else res.writeHead(200).end('ok');
    });
    try {
      await prisma.webhook.create({
        data: { organizationId: org.id, kind: 'generic', url: srv.url, secret: 's', events: 'all' },
      });
      const res = await emitEvent({ organizationId: org.id, type: 'loop_stopped', data: { reason: 'x' } });
      const d = await pollDelivery(res.deliveryIds[0], 'success', 3000);
      expect(d?.status).toBe('success');
      expect(d?.attempts).toBeGreaterThanOrEqual(3);
      expect(hits).toBeGreaterThanOrEqual(3);
    } finally {
      srv.close();
    }
  });

  it('marks delivery failed after exhausting attempts', async () => {
    const org = await makeOrg();
    const srv = await receiver((_req, _body, res) => res.writeHead(500).end('always fail'));
    try {
      await prisma.webhook.create({
        data: { organizationId: org.id, kind: 'generic', url: srv.url, secret: 's', events: 'all' },
      });
      const res = await emitEvent({ organizationId: org.id, type: 'agent_paused', data: { agentId: 'a' } });
      const d = await pollDelivery(res.deliveryIds[0], 'failed', 4000);
      expect(d?.status).toBe('failed');
      expect(d?.attempts).toBe(4); // TBM_WEBHOOK_MAX_ATTEMPTS
    } finally {
      srv.close();
    }
  });

  it('slack channel posts human-readable text (no signature required)', async () => {
    const org = await makeOrg();
    const srv = await receiver((_req, _body, res) => res.writeHead(200).end('ok'));
    try {
      await prisma.webhook.create({ data: { organizationId: org.id, kind: 'slack', url: srv.url, secret: 's', events: 'all' } });
      const res = await emitEvent({ organizationId: org.id, type: 'warning_threshold', data: { budgetName: 'b', utilization: 0.9 } });
      await drainDeliveries();
      await pollDelivery(res.deliveryIds[0], 'success');
      const body = JSON.parse(srv.received[0].body);
      expect(typeof body.text).toBe('string');
      expect(body.text).toContain('warning');
    } finally {
      srv.close();
    }
  });
});
