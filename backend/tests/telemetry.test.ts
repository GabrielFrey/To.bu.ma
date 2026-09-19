import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { trace, context, metrics } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { MeterProvider, MetricReader, type CollectionResult } from '@opentelemetry/sdk-metrics';
import { prisma } from '../src/db.js';
import { resetDb } from './helpers.js';
import { buildServer } from '../src/server.js';
import { hashApiKey } from '../src/crypto.js';
import { withSpan, recordOverhead, recordProviderTime, initTelemetry } from '../src/telemetry.js';

/** A MetricReader whose collect() we can call directly in assertions. */
class TestMetricReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
  collectNow(): Promise<CollectionResult> {
    return this.collect();
  }
}

const spanExporter = new InMemorySpanExporter();
let metricReader: TestMetricReader;

beforeAll(() => {
  // The async-hooks context manager is what makes startActiveSpan propagate the
  // parent span across awaits so child spans nest correctly.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  const tracerProvider = new BasicTracerProvider();
  tracerProvider.addSpanProcessor(new SimpleSpanProcessor(spanExporter));
  trace.setGlobalTracerProvider(tracerProvider);

  metricReader = new TestMetricReader();
  const meterProvider = new MeterProvider({ readers: [metricReader] });
  metrics.setGlobalMeterProvider(meterProvider);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('withSpan', () => {
  beforeEach(() => spanExporter.reset());

  it('exports a named span and returns the function result', async () => {
    const value = await withSpan('unit.span', async () => 42, { 'tbm.k': 'v' });
    expect(value).toBe(42);
    const spans = spanExporter.getFinishedSpans();
    const s = spans.find((x) => x.name === 'unit.span');
    expect(s).toBeTruthy();
    expect(s!.attributes['tbm.k']).toBe('v');
  });

  it('nests child spans under the active parent', async () => {
    await withSpan('unit.parent', async () => {
      await withSpan('unit.child', async () => 1);
    });
    const spans = spanExporter.getFinishedSpans();
    const parent = spans.find((x) => x.name === 'unit.parent')!;
    const child = spans.find((x) => x.name === 'unit.child')!;
    expect(parent).toBeTruthy();
    expect(child).toBeTruthy();
    expect(child.parentSpanId).toBe(parent.spanContext().spanId);
  });

  it('records the exception and rethrows on failure', async () => {
    await expect(
      withSpan('unit.boom', async () => {
        throw new Error('kaboom');
      })
    ).rejects.toThrow('kaboom');
    const s = spanExporter.getFinishedSpans().find((x) => x.name === 'unit.boom')!;
    expect(s.status.code).toBe(2); // SpanStatusCode.ERROR
  });
});

describe('metrics helpers', () => {
  it('record without throwing (safe on any provider)', () => {
    expect(() => recordOverhead(5, { 'tbm.route': 'unit' })).not.toThrow();
    expect(() => recordProviderTime(10, { 'tbm.route': 'unit' })).not.toThrow();
  });
});

describe('initTelemetry', () => {
  it('is a no-op and never throws when no OTLP endpoint is configured', () => {
    const prev = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlag = process.env.TBM_OTEL;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.TBM_OTEL;
    expect(() => initTelemetry()).not.toThrow();
    if (prev) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prev;
    if (prevFlag) process.env.TBM_OTEL = prevFlag;
  });
});

describe('end-to-end trace: check-budget -> provider call -> record-usage', () => {
  let app: FastifyInstance;
  const API_KEY = 'tbm_otel_test_key';

  beforeEach(async () => {
    await resetDb();
    spanExporter.reset();
    const org = await prisma.organization.create({ data: { name: 'OTel Org' } });
    await prisma.apiKey.create({
      data: { organizationId: org.id, name: 'k', keyHash: hashApiKey(API_KEY), role: 'owner' },
    });
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
    if (app) await app.close();
    app = await buildServer();
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('emits the three nested spans and records the overhead + provider metrics', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/llm/complete',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      payload: {
        model: 'gpt-4o-mini',
        provider: 'mock',
        messages: [{ role: 'user', content: 'trace this end to end' }],
        maxTokens: 16,
      },
    });
    expect(res.statusCode).toBe(200);

    const spans = spanExporter.getFinishedSpans();
    const byName = (n: string) => spans.find((s: ReadableSpan) => s.name === n);
    const parent = byName('tbm.llm_complete');
    const check = byName('tbm.check_budget');
    const provider = byName('tbm.provider_call');
    const record = byName('tbm.record_usage');
    expect(parent).toBeTruthy();
    expect(check).toBeTruthy();
    expect(provider).toBeTruthy();
    expect(record).toBeTruthy();
    // All three phases hang under the one request span.
    const pid = parent!.spanContext().spanId;
    expect(check!.parentSpanId).toBe(pid);
    expect(provider!.parentSpanId).toBe(pid);
    expect(record!.parentSpanId).toBe(pid);

    // The overhead and provider histograms both recorded a value.
    const collected = await metricReader.collectNow();
    const allMetrics = collected.resourceMetrics.scopeMetrics.flatMap((sm) => sm.metrics);
    const names = allMetrics.map((m) => m.descriptor.name);
    expect(names).toContain('tbm.overhead.ms');
    expect(names).toContain('tbm.provider.ms');
    const overhead = allMetrics.find((m) => m.descriptor.name === 'tbm.overhead.ms')!;
    expect(overhead.dataPoints.length).toBeGreaterThan(0);
  });
});
