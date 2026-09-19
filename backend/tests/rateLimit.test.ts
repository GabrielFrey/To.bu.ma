import { afterEach, afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { resetDb } from './helpers.js';
import { buildServer } from '../src/server.js';
import { config } from '../src/config.js';

let app: FastifyInstance;

// Snapshot the limits we mutate so other test files are unaffected.
const original = {
  ipRateLimitMax: config.ipRateLimitMax,
  ipRateLimitWindowMs: config.ipRateLimitWindowMs,
  rateLimitMax: config.rateLimitMax,
};

beforeEach(async () => {
  await resetDb();
});

afterEach(async () => {
  config.ipRateLimitMax = original.ipRateLimitMax;
  config.ipRateLimitWindowMs = original.ipRateLimitWindowMs;
  config.rateLimitMax = original.rateLimitMax;
  if (app) {
    await app.close();
    app = undefined as unknown as FastifyInstance;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('per-IP rate limit (in addition to per-key)', () => {
  it('blocks a single IP after it exceeds the per-IP max', async () => {
    config.ipRateLimitMax = 3;
    config.ipRateLimitWindowMs = 60_000;
    config.rateLimitMax = 1000; // keep the per-key limiter out of the way
    app = await buildServer();

    const hit = () => app.inject({ method: 'GET', url: '/health', remoteAddress: '203.0.113.7' });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await hit()).statusCode);

    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[3]).toBe(429);

    const blocked = await hit();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().scope).toBe('ip');
    expect(blocked.headers['retry-after']).toBeTruthy();
    expect(blocked.headers['x-ratelimit-ip-limit']).toBe('3');
  });

  it('tracks each source IP independently', async () => {
    config.ipRateLimitMax = 2;
    config.rateLimitMax = 1000;
    app = await buildServer();

    // Exhaust IP A.
    await app.inject({ method: 'GET', url: '/health', remoteAddress: '198.51.100.1' });
    await app.inject({ method: 'GET', url: '/health', remoteAddress: '198.51.100.1' });
    const aBlocked = await app.inject({ method: 'GET', url: '/health', remoteAddress: '198.51.100.1' });
    expect(aBlocked.statusCode).toBe(429);

    // A different IP still has its full allowance.
    const bOk = await app.inject({ method: 'GET', url: '/health', remoteAddress: '198.51.100.2' });
    expect(bOk.statusCode).toBe(200);
  });

  it('caps aggregate traffic from one IP even across different API keys', async () => {
    config.ipRateLimitMax = 3;
    config.rateLimitMax = 1000; // per-key limit is generous; the IP cap should bind
    app = await buildServer();

    const inject = (key: string) =>
      app.inject({
        method: 'GET',
        url: '/health',
        remoteAddress: '203.0.113.9',
        headers: { 'x-api-key': key },
      });

    expect((await inject('key-a')).statusCode).toBe(200);
    expect((await inject('key-b')).statusCode).toBe(200);
    expect((await inject('key-c')).statusCode).toBe(200);
    // Fourth request from the same IP, even with a fresh key, is capped.
    expect((await inject('key-d')).statusCode).toBe(429);
  });

  it('is disabled when the per-IP max is set to 0', async () => {
    config.ipRateLimitMax = 0;
    config.rateLimitMax = 1000;
    app = await buildServer();

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await app.inject({ method: 'GET', url: '/health', remoteAddress: '203.0.113.5' })).statusCode);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});
