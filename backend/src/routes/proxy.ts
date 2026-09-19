import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { authenticateProxy } from '../auth.js';
import { decryptSecret } from '../crypto.js';
import { checkBudget, type CheckBudgetResult } from '../services/gateway.js';
import { recordUsage } from '../services/accounting.js';
import { readScopeHeaders, resolveScopeFromHeaders } from '../services/scope.js';
import { compressContextIfNeeded } from '../services/optimization.js';
import { forwardUpstream, pipeAndCaptureSse, type UpstreamKind, type UpstreamMode } from '../services/upstream.js';
import { estimateTokens, type ChatMessage } from '../tokenizer.js';
import { performance } from 'node:perf_hooks';
import { withSpan, recordOverhead, recordProviderTime } from '../telemetry.js';
import {
  chatProxyBodySchema,
  completionsProxyBodySchema,
  embeddingsProxyBodySchema,
} from './schemas.js';
import type { ScopeChain } from '../types.js';

/** Bounded body validator per proxy kind (see schemas.ts for the rationale). */
function proxyBodySchema(kind: UpstreamKind) {
  return kind === 'chat'
    ? chatProxyBodySchema
    : kind === 'completions'
      ? completionsProxyBodySchema
      : embeddingsProxyBodySchema;
}

/** Map a blocking policy decision to an OpenAI-style error + HTTP status. */
function blockedError(check: CheckBudgetResult): { status: number; body: unknown } {
  const d = check.decision;
  const status = d === 'retry-limit' || d === 'tool-limit' ? 429 : 402;
  const code =
    d === 'require-approval' ? 'approval_required'
    : d === 'retry-limit' ? 'retry_limit_exceeded'
    : d === 'tool-limit' ? 'tool_limit_exceeded'
    : 'budget_exceeded';
  return {
    status,
    body: {
      error: {
        message: `Token Budget Manager blocked this request: ${check.reason}`,
        type: 'insufficient_quota',
        code,
        param: null,
        tbm: {
          decision: d,
          reason: check.reason,
          requestId: check.requestId,
          forecast: check.forecast,
        },
      },
    },
  };
}

function usageFromResponse(kind: UpstreamKind, json: any) {
  const u = json?.usage ?? {};
  return {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: kind === 'embeddings' ? 0 : (u.completion_tokens ?? 0),
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    toolTokens: 0,
    present: json?.usage != null,
  };
}

/** Compute a token target for compress/truncate from the most restrictive token budget. */
function compressionTarget(check: CheckBudgetResult): number {
  const tokenBudgets = check.budgets.filter((b) => b.metric === 'TOKENS');
  if (tokenBudgets.length === 0) return check.forecast.promptTokens;
  const minRemaining = Math.min(...tokenBudgets.map((b) => b.remaining));
  return Math.max(128, Math.floor(minRemaining - check.forecast.expectedCompletionTokens));
}

async function loadUpstreamKey(organizationId: string, mode: UpstreamMode): Promise<string | undefined> {
  if (mode === 'mock') return undefined;
  const pk = await prisma.providerKey.findFirst({ where: { organizationId, provider: 'openai' } });
  if (pk) return decryptSecret(pk.ciphertext);
  return config.openaiApiKey || undefined;
}

/**
 * Traced proxy entry point: one `tbm.proxy` span wraps the budget check, the
 * provider call, and record-usage; the overhead metric is total time minus the
 * measured provider time so TBM's own cost is reported separately.
 */
async function handleProxy(req: FastifyRequest, reply: FastifyReply, kind: UpstreamKind) {
  return withSpan(
    'tbm.proxy',
    async () => {
      const started = performance.now();
      const timing = { providerMs: 0, decision: 'allow' };
      try {
        return await runProxy(req, reply, kind, timing);
      } finally {
        const attrs = { 'tbm.route': 'proxy', 'tbm.kind': kind, 'tbm.decision': timing.decision };
        recordProviderTime(timing.providerMs, attrs);
        recordOverhead(performance.now() - started - timing.providerMs, attrs);
      }
    },
    { 'tbm.kind': kind }
  );
}

async function runProxy(
  req: FastifyRequest,
  reply: FastifyReply,
  kind: UpstreamKind,
  timing: { providerMs: number; decision: string }
) {
  const organizationId = req.auth!.organizationId;

  // Validate + bound the body BEFORE any tokenizer work. A malformed or oversized
  // body is rejected with an OpenAI-style 400 so SDK clients see a wire-compatible
  // error instead of the generic Zod shape (and never reach tiktoken).
  let payload: any;
  try {
    payload = proxyBodySchema(kind).parse(req.body ?? {});
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      return reply.code(400).send({
        error: {
          message: `Invalid request body: ${issue?.message ?? 'validation failed'}`,
          type: 'invalid_request_error',
          code: 'invalid_request',
          param: issue?.path.length ? issue.path.join('.') : null,
        },
      });
    }
    throw err;
  }
  const model: string = payload.model ?? 'gpt-4o-mini';

  // 1. Resolve tenant scope from headers (find-or-create by name).
  const scope: ScopeChain = await resolveScopeFromHeaders(organizationId, readScopeHeaders(req.headers as Record<string, unknown>));

  // 2. Per-request upstream override.
  const upstreamHeader = (req.headers['x-tbm-upstream'] as string | undefined)?.trim();
  const mode: UpstreamMode = upstreamHeader === 'mock' ? 'mock' : upstreamHeader === 'openai' ? 'openai' : config.proxyUpstream;

  // 3. Build the messages the gateway reasons about.
  let messages: ChatMessage[];
  let expectedCompletionTokens: number | undefined;
  if (kind === 'chat') {
    messages = (payload.messages ?? []) as ChatMessage[];
    expectedCompletionTokens = payload.max_tokens;
  } else if (kind === 'completions') {
    messages = [{ role: 'user', content: String(payload.prompt ?? '') }];
    expectedCompletionTokens = payload.max_tokens;
  } else {
    const input = payload.input;
    const text = Array.isArray(input) ? input.join('\n') : String(input ?? '');
    messages = [{ role: 'user', content: text }];
    expectedCompletionTokens = 0;
  }

  // 4. Run the full gateway (estimate -> budgets -> policy -> reservation).
  const check = await checkBudget({
    chain: scope,
    model,
    provider: mode === 'mock' ? 'mock' : 'openai',
    messages,
    expectedCompletionTokens,
  });

  timing.decision = check.decision;

  // 5. Truthful enforcement: block BEFORE forwarding.
  if (!check.allowed) {
    const { status, body } = blockedError(check);
    return reply
      .code(status)
      .header('x-tbm-decision', check.decision)
      .header('x-tbm-request-id', check.requestId ?? '')
      .send(body);
  }

  // 6. Apply optimization decisions to the OUTGOING request.
  if (check.recommendedModel && ['degrade', 'compress', 'summarize'].includes(check.decision)) {
    payload.model = check.recommendedModel; // degrade: actually swap the model
  }
  if (kind === 'chat' && ['compress', 'summarize', 'truncate'].includes(check.decision)) {
    const target = compressionTarget(check);
    const comp = compressContextIfNeeded({ messages, model: payload.model ?? model, targetTokens: target });
    payload.messages = comp.messages; // compress/truncate: actually modify messages
    messages = comp.messages;
  }

  const apiKey = await loadUpstreamKey(organizationId, mode);
  const isStream = kind !== 'embeddings' && !!payload.stream;
  const includeUsage = !!payload.stream_options?.include_usage;

  // 7. Forward to the upstream provider.
  let upstream: Response;
  const providerStart = performance.now();
  try {
    upstream = await withSpan(
      'tbm.provider_call',
      () => forwardUpstream({ kind, mode, payload, apiKey }),
      { 'tbm.provider': mode, 'tbm.kind': kind, 'tbm.model': payload.model ?? model }
    );
    timing.providerMs = performance.now() - providerStart;
  } catch (err) {
    timing.providerMs = performance.now() - providerStart;
    await recordUsage({
      requestId: check.requestId!,
      organizationId,
      usage: { inputTokens: check.forecast.promptTokens, outputTokens: 0 },
      status: 'failed',
    });
    return reply.code(502).send({
      error: { message: `Upstream error: ${(err as Error).message}`, type: 'api_error', code: 'upstream_error', param: null },
    });
  }

  const contentType = upstream.headers.get('content-type') ?? '';

  // 8a. Streaming path.
  if (isStream && upstream.ok && contentType.includes('text/event-stream') && upstream.body) {
    const estimated = !includeUsage; // upstream only returns usage when asked
    reply.hijack();
    reply.raw.writeHead(upstream.status, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-tbm-request-id': check.requestId ?? '',
      'x-tbm-decision': check.decision,
      'x-tbm-usage-estimated': String(estimated),
    });
    const { content, usage } = await pipeAndCaptureSse(upstream.body as ReadableStream<Uint8Array>, (bytes) =>
      reply.raw.write(Buffer.from(bytes))
    );

    // Record actuals (or a tokenizer estimate if upstream omitted usage) BEFORE
    // closing the socket so accounting is durable by the time the call returns.
    await recordUsage({
      requestId: check.requestId!,
      organizationId,
      model: payload.model ?? model,
      usage: {
        inputTokens: usage?.prompt_tokens ?? check.forecast.promptTokens,
        outputTokens: usage?.completion_tokens ?? estimateTokens(content, payload.model ?? model),
        cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
      status: 'completed',
    });

    reply.raw.end();
    return reply;
  }

  // 8b. Non-streaming (or upstream returned JSON, e.g. an error).
  const json: any = await upstream.json().catch(() => ({}));

  if (!upstream.ok) {
    await recordUsage({
      requestId: check.requestId!,
      organizationId,
      usage: { inputTokens: check.forecast.promptTokens, outputTokens: 0 },
      status: 'failed',
    });
    return reply.code(upstream.status).header('x-tbm-request-id', check.requestId ?? '').send(json);
  }

  const u = usageFromResponse(kind, json);
  await recordUsage({
    requestId: check.requestId!,
    organizationId,
    model: json.model ?? payload.model ?? model,
    usage: {
      inputTokens: u.present ? u.inputTokens : check.forecast.promptTokens,
      outputTokens: u.present ? u.outputTokens : (kind === 'embeddings' ? 0 : estimateTokens(json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? '', payload.model ?? model)),
      cachedTokens: u.cachedTokens,
    },
    status: 'completed',
  });

  return reply
    .code(200)
    .header('x-tbm-request-id', check.requestId ?? '')
    .header('x-tbm-decision', check.decision)
    .header('x-tbm-usage-estimated', String(!u.present))
    .send(json);
}

/**
 * Transparent, OpenAI-compatible proxy. Point any OpenAI SDK at
 * `http://<host>/v1` with a TBM API key and every call is budgeted + recorded.
 */
export async function registerProxyRoutes(app: FastifyInstance) {
  app.register(
    async (proxy) => {
      proxy.addHook('preHandler', authenticateProxy);
      proxy.post('/chat/completions', (req, reply) => handleProxy(req, reply, 'chat'));
      proxy.post('/completions', (req, reply) => handleProxy(req, reply, 'completions'));
      proxy.post('/embeddings', (req, reply) => handleProxy(req, reply, 'embeddings'));
    },
    { prefix: '/v1' }
  );
}
