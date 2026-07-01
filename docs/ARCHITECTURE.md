# Token Budget Manager — Architecture

## 1. Purpose & positioning

The Token Budget Manager (TBM) is a **control and optimization layer that sits between AI
agents and LLM APIs**. It is not a passive monitor: every LLM call flows through a
decision point that can **allow, warn, degrade, compress, summarize, truncate,
require-approval, or stop** the call *before* it is sent to the provider, and every call is
**accounted** afterwards.

```
                +-------------------------------------------------------------+
                |                     Token Budget Manager                    |
   Agent /      |                                                             |
   SDK   ---->  |  Token Gateway  -->  Budget Engine  -->  Policy Engine      |  --> LLM Provider
   (few lines)  |     (estimate)        (resolve)          (decide)           |      (OpenAI / mock)
                |        |                  |                   |             |
                |        v                  v                   v             |
                |  Token Accounting  <--  Storage  <--  Policy Events / Audit |
                +-------------------------------------------------------------+
                                          |
                                          v
                                Observability Dashboard (React)
```

Two integration styles are supported:

1. **Advisory / SDK-mediated (MVP default).** The agent calls `beforeLLMCall()` → gets a
   decision → makes the LLM call itself (or lets the SDK proxy it) → calls `afterLLMCall()`.
   This is what the SDK does and what the acceptance criteria exercise.
2. **Proxy gateway (documented, partially stubbed).** TBM exposes an OpenAI-compatible
   `/v1/chat/completions` endpoint so *any* OpenAI client can point its base URL at TBM and
   get enforcement for free. The MVP ships the check/record primitives that a full proxy
   would compose; the proxy route itself is a thin wrapper (see MVP.md, deferred list).

## 2. Components

### 2.1 Token Gateway / middleware
The entry point for a call. Responsibilities:
- Authenticate the caller (API key → org/workspace/user scope).
- **Pre-request estimation**: prompt tokens, expected completion tokens, reserved tokens,
  estimated cost, remaining budget, overflow risk.
- Ask the Budget Engine to resolve the effective budget, then ask the Policy Engine for a
  decision. Return the decision to the caller (allow / modified request / block).
- After the real call, hand actuals to the Token Accounting Service.

### 2.2 Budget Engine
Owns budgets and their **hierarchical resolution**. A budget has:
`hardLimit`, `softLimit`, `warningThreshold`, `resetPeriod`, `priority`, `fallbackBehavior`,
scope (`level` + `scopeId`), and a `metric` (tokens or cost-USD).

Resolution: given a call's context (org → project → user → agent → session → task →
tool-call → request), the engine collects **every budget that applies** to any level in that
chain and evaluates each independently. See [DATA_MODEL.md](./DATA_MODEL.md) for the
**most-restrictive-wins** algorithm and worked examples.

### 2.3 Token Accounting Service
Turns raw usage into ledger entries. Responsibilities:
- Convert pre-request estimates into a **reservation** (soft hold) so parallel agents don't
  race past a hard limit.
- On completion, write the **actual** `token_usage` row (input / output / cached / tool
  tokens), compute cost from `model_pricing`, release the reservation, and roll up
  aggregates used by budget checks and the dashboard.
- Idempotent on `llm_request.id` so retries don't double-count.

### 2.4 Policy Engine
Given budget utilization + call context, emits one **decision**:

| Decision | Meaning | Trigger example |
|---|---|---|
| `allow` | proceed unchanged | under soft limit |
| `warn` | proceed, emit warning event | crossed warning threshold |
| `degrade` | proceed but downgrade something | near soft limit |
| `compress` | prune/compact context before sending | prompt large + budget tight |
| `summarize` | replace old context with a summary | long session, memory growth |
| `truncate` | hard-cut the prompt to fit | request would overflow reserve |
| `require-approval` | block until a human approves | single call cost > threshold |
| `stop-agent` | pause the agent, block calls | hard limit reached |
| `retry-limit` | block: too many retries | N failed attempts on same task |
| `tool-limit` | block: too many tool calls | tool-call budget exhausted |

Policies are **data** (`budget_policies` rows: condition → action + params), evaluated in
priority order; the first matching non-`allow` action wins, but `stop-agent`/`require-approval`
always dominate. Decisions are persisted to `policy_events` (audit) **and returned to the
caller so they change execution** — not merely logged.

### 2.5 Observability Dashboard
React + Vite SPA. Reads the analytics REST endpoints: total spend, spend by agent/task/
project, active budgets & utilization, warnings, blocked requests, most expensive prompts,
inefficient/looping agents, and optimization recommendations.

### 2.6 SDK / API
- **REST API** (Fastify) — see below.
- **SDKs**: TypeScript (primary) and Python wrapper, conceptually identical surface:
  `beforeLLMCall`, `afterLLMCall`, `estimateTokens`, `enforceBudget`, `chooseModel`,
  `compressContextIfNeeded`, `recordToolUsage`.

### 2.7 Storage layer
PostgreSQL via Prisma. For a zero-dependency local run the MVP uses **SQLite through the
same Prisma client** (schema kept Postgres-compatible; switch documented in README).

## 3. Why these choices (trade-offs summarized; full list in README)

- **Fastify over Express.** First-class TypeScript types, built-in JSON-schema validation,
  ~2× throughput. TBM is on the hot path of every LLM call, so per-request overhead matters.
- **REST over GraphQL for MVP.** The surface is a small set of verb-like actions
  (`check-budget`, `record-usage`, …) with simple, cacheable shapes. REST needs no extra
  client tooling, is trivial to call from the Python SDK and from an OpenAI-compatible proxy,
  and keeps auth/rate-limiting per-route obvious. GraphQL's flexible querying buys little here
  and adds resolver/N+1 complexity. Analytics aggregation is better done server-side anyway.
- **SQLite-via-Prisma for the runnable MVP.** Lets a reviewer `npm run demo` with no Docker/
  Postgres. Same Prisma schema targets Postgres in prod (`provider = "postgresql"`); we avoid
  Postgres-only column types in the MVP so the schema is portable.
- **js-tiktoken for estimation.** Accurate BPE token counts matching OpenAI models, with a
  documented `chars/4` heuristic fallback when a model's encoding is unknown or for speed.

## 4. Estimation flow

**Pre-request** (`check-budget`):
1. Count `promptTokens` with tiktoken for the target model (fallback heuristic if unknown).
2. `expectedCompletionTokens` = caller hint or model default (e.g. `maxTokens`).
3. `reservedTokens` = prompt + expectedCompletion (+ safety margin).
4. `estimatedCost` from `model_pricing`.
5. Budget Engine returns `remaining` for each applicable budget; `overflowRisk` = would
   `used + reservedTokens` exceed a hard limit on any budget.
6. Policy Engine returns the decision; a reservation is created if allowed.

**Post-request** (`record-usage`):
- Capture actual `inputTokens`, `outputTokens`, `cachedTokens`, `toolTokens` from the provider
  response (`usage` field). Compute cost. Write `token_usage`, finalize the `llm_request`,
  release the reservation, update rollups. Idempotent per request id.

## 5. Agentic scenarios

- **Multi-step reasoning / recursive planning loops** — every step is an `llm_request` tied to
  a `session` and `task`; session/task budgets bound the whole chain regardless of step count.
- **Tool calls** — recorded via `recordToolUsage`; a `tool-limit` policy caps calls/tokens per
  task, stopping runaway tool spirals.
- **Parallel agents / subagents** — reservations make hard limits safe under concurrency; an
  org/project budget bounds the fleet even as individual agents each stay under their own.
- **Long-running sessions / memory growth** — `compress`/`summarize` policies fire as the
  session's rolling context grows, keeping prompt tokens bounded.
- **Retries / repeated failed attempts** — the accounting service tracks attempts per
  `(task, request-signature)`; a `retry-limit` policy blocks after N failures.
- **Model switching** — `chooseModel` downgrades to a cheaper model when budget is tight; each
  request records the model actually used for correct pricing.
- **Task priority** — budgets carry `priority`; degrade/stop decisions prefer to throttle
  low-priority tasks first.

### Detecting useless loops & repeated failures
The accounting service computes a **request signature** = hash(normalized prompt + model). For a
given task it tracks: (a) count of near-identical signatures (a loop making no progress) and
(b) count of requests that ended in error/`failed`. Two lightweight signals:
- **Loop signal**: same signature seen ≥ `loopThreshold` times within a session → recommend/act
  `stop-agent`.
- **Failed-attempt signal**: ≥ `retryThreshold` failed attempts on a task → `retry-limit`.
These power both live policy decisions and the dashboard "inefficient agent loops" view.

## 6. Security design

- **Multi-tenant isolation.** Every row is scoped to an `organizationId`; all queries filter by
  the authenticated key's org. No cross-org reads.
- **RBAC.** Roles `owner` / `admin` / `member` / `viewer` gate write vs read vs approval routes.
- **API-key encryption at rest.** TBM API keys are stored as salted hashes (never plaintext).
  **Provider keys** (OpenAI etc.) are encrypted with AES-256-GCM using a server master key
  (`MASTER_KEY` env) and **provider-key isolation** — decrypted only in the provider adapter,
  never returned by any API.
- **Audit logs.** `policy_events` + an `audit_log` capture who/what/when for budget changes,
  approvals, and every enforcement decision.
- **Rate limiting.** Per-API-key token-bucket on all routes (Fastify rate-limit).
- **Approval workflow.** `require-approval` decisions create an `approvals` row (pending); the
  call is blocked until an authorized user approves/denies via the API/dashboard.

See [DATA_MODEL.md](./DATA_MODEL.md) for the concrete schema and budget-resolution algorithm.
