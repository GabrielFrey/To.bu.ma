import { createRequire } from 'node:module';
import { trace, metrics, SpanStatusCode, type Attributes, type Span } from '@opentelemetry/api';

/**
 * OpenTelemetry instrumentation for the TBM control layer.
 *
 * Design goal: **safe by default**. We instrument against `@opentelemetry/api`,
 * whose tracer/meter are no-ops until an SDK is registered. So with no collector
 * configured (the demo, tests, local dev) spans and metrics cost effectively
 * nothing and never throw. Export is opt-in: `initTelemetry()` starts a real
 * NodeSDK only when `OTEL_EXPORTER_OTLP_ENDPOINT` (or `TBM_OTEL=1`) is set, and
 * even then a failure to start is logged and swallowed rather than crashing.
 *
 * Two histograms make TBM's own overhead honest and separable:
 *   - `tbm.overhead.ms`  — wall time spent inside the TBM layer (budget check,
 *                          policy eval, reservation, accounting), EXCLUDING the
 *                          upstream provider call.
 *   - `tbm.provider.ms`  — wall time spent in the upstream provider call.
 */

const SERVICE_NAME = 'tbm-backend';
const tracer = trace.getTracer('tbm-gateway');

// Instruments are created lazily on first use. Because the API meter is a proxy,
// deferring creation lets a MeterProvider registered after import (e.g. by
// initTelemetry or a test's in-memory reader) back these histograms.
let overheadHistogram: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']> | null = null;
let providerHistogram: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']> | null = null;

function overhead() {
  if (!overheadHistogram) {
    overheadHistogram = metrics.getMeter('tbm-gateway').createHistogram('tbm.overhead.ms', {
      description: 'Latency added by the TBM control layer, excluding the upstream provider call',
      unit: 'ms',
    });
  }
  return overheadHistogram;
}

function providerTime() {
  if (!providerHistogram) {
    providerHistogram = metrics.getMeter('tbm-gateway').createHistogram('tbm.provider.ms', {
      description: 'Time spent in the upstream provider call',
      unit: 'ms',
    });
  }
  return providerHistogram;
}

/** Record the TBM layer's own overhead (ms), separate from provider time. */
export function recordOverhead(ms: number, attrs: Attributes = {}): void {
  overhead().record(Math.max(0, ms), attrs);
}

/** Record time spent in the upstream provider call (ms). */
export function recordProviderTime(ms: number, attrs: Attributes = {}): void {
  providerTime().record(Math.max(0, ms), attrs);
}

/**
 * Run `fn` inside an active span so nested spans (check-budget → provider call →
 * record-usage) form one trace. Records exceptions and status; always ends the
 * span. A no-op tracer makes this near-free when nothing is exporting.
 */
export function withSpan<T>(name: string, fn: (span: Span) => Promise<T>, attrs: Attributes = {}): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      span.setAttributes(attrs);
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

let sdkStarted = false;

/**
 * Optionally start the OpenTelemetry SDK. No-op unless an OTLP endpoint (or
 * `TBM_OTEL=1`) is configured, and resilient to a missing/broken collector: any
 * failure is logged and the process continues with the no-op API.
 */
export function initTelemetry(): void {
  if (sdkStarted) return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const enabled = !!endpoint || process.env.TBM_OTEL === '1';
  if (!enabled) return; // no collector → stay on the no-op API

  try {
    const require = createRequire(import.meta.url);
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
    const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
    const { Resource } = require('@opentelemetry/resources');
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? SERVICE_NAME,
      }),
      traceExporter: new OTLPTraceExporter(),
      metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
    });
    sdk.start();
    sdkStarted = true;

    const shutdown = () => {
      sdk.shutdown().catch(() => {});
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);

    // eslint-disable-next-line no-console
    console.log('[tbm] OpenTelemetry export enabled');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[tbm] OpenTelemetry init failed; continuing without export', err);
  }
}
