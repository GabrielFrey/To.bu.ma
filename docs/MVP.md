# Token Budget Manager — MVP definition

The MVP is the smallest slice that satisfies every acceptance criterion end-to-end with a
runnable demo and no external services.

## In scope (built)

**Backend (Fastify + Prisma/SQLite)**
- Auth via `x-api-key` → org scope (seeded key for the demo).
- Budget Engine module with hierarchical **most-restrictive-wins** resolution + reservations.
- Token Accounting Service: reserve → record actuals (input/output/cached/tool) → cost from
  `model_pricing` → rollups. Idempotent per request id.
- Policy Engine: data-driven `budget_policies`, decisions
  `allow/warn/degrade/compress/summarize/truncate/require-approval/stop-agent/retry-limit/tool-limit`,
  persisted to `policy_events` **and returned to the caller so they change execution**.
- REST endpoints:
  - `POST /v1/budgets`, `PATCH /v1/budgets/:id`, `GET /v1/budgets`
  - `POST /v1/policies`
  - `POST /v1/check-budget` (pre-request forecast + decision + reservation)
  - `POST /v1/record-usage` (post-request actuals)
  - `GET /v1/analytics/*` (total, by-agent, by-task, by-project, warnings, blocked,
    expensive-prompts, loops, recommendations)
  - `POST /v1/agents/:id/pause`, `POST /v1/agents/:id/resume`
  - `POST /v1/approvals/:id/approve`, `POST /v1/approvals/:id/deny`
  - `POST /v1/llm/complete` — convenience route that does check → provider call → record in one
    shot (used by the demo to prove the end-to-end flow).
- Providers: **OpenAI-compatible adapter** (real) + **mock provider** (offline/tests).
- Pricing seed for common OpenAI models.

**SDK**
- TypeScript SDK (primary): `beforeLLMCall`, `afterLLMCall`, `estimateTokens`, `enforceBudget`,
  `chooseModel`, `compressContextIfNeeded`, `recordToolUsage` + a few-lines integration example.
- Python wrapper with the same conceptual surface + example.

**Dashboard (React + Vite + Tailwind)**
- Views: total spend, spend by agent/task, active budgets & utilization, warnings, blocked
  requests, most expensive prompts, inefficient loops, recommendations. Wired to the API.

**Optimization (Phase 6)** — implemented: token estimation, `chooseModel` cheaper-routing,
context pruning/compression, loop detection, repeated-failure detection, prompt-dedup signature.
Stubbed/documented: request batching, cached-context reuse accounting beyond the `cachedTokens`
field.

**Scale & observability (Phase 7)** — implemented: pluggable token-reservation store with an
optional Redis backend for multi-node headroom (`REDIS_URL`; DB store by default);
OpenTelemetry tracing of check-budget → provider call → record-usage plus a `tbm.overhead.ms`
metric that isolates the control layer's own latency from provider time (opt-in exporter, no-op
without a collector); semantic (embedding-based) context compression as a pluggable strategy
that falls back to the heuristic compressor when no embedding provider is configured.

**Tests** — Vitest unit tests for Budget Engine + Token Accounting (acceptance criterion) and an
integration test for check → mock LLM → record → analytics. `npm run demo` scripts the same flow.

## Deferred (documented, not built or stubbed)

- **Full OpenAI-compatible proxy route** (`/v1/chat/completions` passthrough). The primitives
  exist; wiring a transparent proxy that rewrites arbitrary provider payloads is deferred.
- **Full RBAC UI & user management screens** — roles are enforced in the API; the dashboard is
  read-mostly for the demo.
- **Streaming token accounting** — MVP records usage from the final `usage` object; streaming
  incremental accounting is deferred.

## Acceptance criteria → where satisfied

1. Hard budget cannot be exceeded → Budget Engine + reservations, integration test `enforce`.
2. Every request accounted → `check-budget` creates request row; `record-usage` writes usage.
3. Pre + post exist → `check-budget` (forecast) and `record-usage` (actuals).
4. Spend by agent/task/project → analytics endpoints + dashboard.
5. Policies affect execution → decisions returned & enforced by gateway/SDK, not just logged.
6. Real provider + mock → OpenAI adapter + mock adapter.
7. Tests for Budget Engine + Accounting pass → Vitest suites.
8. Dashboard shows current data → wired to analytics API.
9. SDK integrates in a few lines → TS/Python examples.
