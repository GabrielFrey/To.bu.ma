# Token Budget Manager (TBM)

A **control & optimization layer that sits between AI agents and LLM APIs.** Every LLM call
flows through a decision point that can **allow / warn / degrade / compress / summarize /
truncate / require-approval / stop-agent / retry-limit / tool-limit** *before* the call is
sent, and every call is **accounted** afterwards. TBM guarantees an agent cannot exceed a hard
token (or cost) budget, makes spend observable by agent/task/project, and ships SDKs that drop
into an existing agent in a few lines.

> Not just monitoring — it enforces.

## Contents

```
token-budget-manager/
├── docs/            # ARCHITECTURE.md, DATA_MODEL.md, MVP.md
├── backend/         # Fastify + Prisma API, engines, providers, tests, demo
│   ├── src/         # config, db, crypto, tokenizer, pricing, services/, providers/, routes, server, seed, demo
│   ├── prisma/      # schema.prisma (SQLite for MVP, Postgres-compatible)
│   └── tests/       # Vitest: budgetEngine, accounting, integration
├── dashboard/       # React + Vite + Tailwind observability UI
└── sdk/
    ├── typescript/  # primary SDK + example.ts
    └── python/      # wrapper SDK + example.py
```

Design docs (read first): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md), [`docs/MVP.md`](docs/MVP.md).

## Requirements

- Node.js ≥ 18 (developed on 20.x)
- Python ≥ 3.9 (only for the Python SDK)
- No external services required — the MVP runs on SQLite via Prisma.

## Quick start

```bash
# 1. Backend
cd backend
npm install
cp .env .env.local 2>/dev/null || true      # .env is already provided for local dev
npm run prisma:generate                       # generate the Prisma client
npm run db:setup                              # create SQLite schema + seed demo data (prints the API key)

# 2. Prove the whole flow end-to-end (offline, mock provider)
npm run demo                                  # check-budget -> mock LLM -> record-usage -> analytics + enforcement

# 3. Run the API
npm run dev                                   # http://localhost:4000  (health: GET /health)

# 4. Dashboard (new terminal)
cd ../dashboard
npm install
npm run dev                                   # http://localhost:5173 (proxies /v1 to :4000)
```

The seeded demo API key is **`tbm_demo_local_key`** (owner role). The dashboard defaults to it.

## Running the tests

```bash
cd backend
npm run typecheck      # tsc --noEmit, must be clean
npm test               # Vitest: 23 tests incl. Budget Engine + Token Accounting (acceptance criterion #7)
```

Tests use an isolated `prisma/test.db` created fresh per run (see `tests/globalSetup.ts`).

## Building the dashboard

```bash
cd dashboard
npm run build          # tsc --noEmit && vite build  -> dist/
```

## Integrating the SDK (a few lines)

### TypeScript

```ts
import { TokenBudgetClient } from '@tbm/sdk';

const tbm = new TokenBudgetClient({ baseUrl: 'http://localhost:4000', apiKey: 'tbm_demo_local_key' });

const check = await tbm.beforeLLMCall({ model: 'gpt-4o-mini', messages, expectedCompletionTokens: 128 });
tbm.enforceBudget(check);                       // throws BudgetExceededError if blocked
const resp = await openai.chat.completions.create({ model: check.recommendedModel ?? 'gpt-4o-mini', messages });
await tbm.afterLLMCall({ requestId: check.requestId!, usage: {
  inputTokens: resp.usage.prompt_tokens, outputTokens: resp.usage.completion_tokens,
}});
```

Run the working example (needs backend running + seeded):
```bash
cd sdk/typescript && npm install && npm run example
```

### Python

```python
from tbm_sdk import TokenBudgetClient
tbm = TokenBudgetClient(api_key="tbm_demo_local_key", base_url="http://localhost:4000")

check = tbm.before_llm_call(model="gpt-4o-mini", messages=messages, expected_completion_tokens=128)
tbm.enforce_budget(check)                        # raises BudgetExceededError if blocked
resp = openai.chat.completions.create(model=check.recommendedModel or "gpt-4o-mini", messages=messages)
tbm.after_llm_call(request_id=check.requestId, usage={
    "inputTokens": resp.usage.prompt_tokens, "outputTokens": resp.usage.completion_tokens,
})
```

Run the working example:
```bash
cd sdk/python && TBM_API_KEY=tbm_demo_local_key python3 example.py
# optional accurate estimation: pip install tiktoken
```

SDK methods (identical surface in both languages): `beforeLLMCall`, `afterLLMCall`,
`estimateTokens`, `enforceBudget`, `chooseModel`, `compressContextIfNeeded`, `recordToolUsage`
(+ `complete` convenience that runs the whole gateway via the server's mock provider).

## Using a real LLM provider (OpenAI-compatible)

1. Put a key in `backend/.env`: `OPENAI_API_KEY="sk-..."` (and `OPENAI_BASE_URL` for compatible
   endpoints). Re-run `npm run db:setup` to store it **encrypted at rest** (AES-256-GCM) as a
   `provider_key`.
2. Call any endpoint with `"provider": "openai"` (e.g. `POST /v1/llm/complete`). The adapter
   decrypts the key only inside the provider and never returns it.

## REST API (all under `/v1`, require `x-api-key`)

| Method & path | Purpose |
|---|---|
| `POST /budgets`, `PATCH /budgets/:id`, `GET /budgets` | manage budgets |
| `POST /policies` | attach a condition→action policy to a budget |
| `POST /check-budget` | **pre-request** forecast + decision + reservation |
| `POST /record-usage` | **post-request** actuals (idempotent) |
| `POST /record-tool-usage` | account tool-call tokens |
| `POST /llm/complete` | check → provider call → record in one shot |
| `POST /optimize/compress`, `/optimize/choose-model` | optimization helpers |
| `POST /agents/:id/pause` \| `/resume` | stop/allow an agent |
| `GET /approvals`, `POST /approvals/:id/approve` \| `/deny` | approval workflow |
| `GET /analytics/{total,by-agent,by-task,by-project,active-budgets,warnings,blocked,expensive-prompts,loops,recommendations}` | dashboard data |

## Switching SQLite → PostgreSQL

1. In `backend/prisma/schema.prisma` change `datasource db { provider = "postgresql" }`.
2. Set `DATABASE_URL="postgresql://user:pass@host:5432/tbm"` in `.env`.
3. `npx prisma migrate dev` (or `db push`) then `npm run db:setup`.

The schema avoids Postgres-only types and models enums as validated string columns, so it runs
unchanged on both engines.

## Optimization features (Phase 6)

**Implemented:** accurate tiktoken estimation (+ heuristic fallback), cheaper-model routing
(`chooseModel`), prompt deduplication, context pruning, memory summarization (extractive),
`compressContextIfNeeded` pipeline, useless-loop detection (request signatures), repeated
failed-attempt detection, cached-token cost discounting.

**Stubbed / deferred (documented):** semantic (embedding-based) compression — needs an embedding
provider; request batching; distributed reservation store (Redis) for multi-node scale;
transparent OpenAI-compatible proxy route; streaming incremental accounting. See
[`docs/MVP.md`](docs/MVP.md) for the full deferred list.

## Key engineering trade-offs

- **Fastify over Express** — TBM is on the hot path of every LLM call; Fastify's schema
  validation and higher throughput matter. Cost: a smaller middleware ecosystem than Express.
- **REST over GraphQL (MVP)** — the surface is a few verb-like actions with simple shapes;
  REST is trivial to call from the Python SDK and an OpenAI-compatible proxy, needs no client
  tooling, and keeps per-route auth/rate-limiting obvious. GraphQL's flexible querying adds
  resolver/N+1 complexity for little gain here. Cost: clients compose multiple calls for the
  dashboard (mitigated by server-side aggregation endpoints).
- **SQLite-via-Prisma vs Postgres** — SQLite makes the MVP `npm run demo`-runnable with zero
  infra; the identical Prisma schema targets Postgres in prod. Cost: SQLite's weaker
  concurrency; reservations are DB rows (fine single-node, Redis noted for scale).
- **Budget resolution = most-restrictive-wins** — safe by construction (any exhausted hard
  budget blocks), simple to reason about, and matches operator intent. Cost: it can't express
  "borrow from a parent budget"; priority/fallback fields leave room to evolve.
- **Estimation accuracy vs speed** — tiktoken gives provider-accurate prompt counts (what
  enforcement keys on) at the cost of loading an encoding; a `chars/4` heuristic is the
  documented fallback for unknown models / hot paths.
- **Sync vs async enforcement** — enforcement is **synchronous** on `check-budget` (the call is
  blocked before dispatch) so hard limits are truly hard; accounting rollups are computed on
  read. Reservations bridge the check→record gap so concurrent agents can't collectively
  overshoot. Cost: a read-time aggregation per check (indexed; acceptable for the MVP).

## Security

Multi-tenant isolation (every query scoped to the API key's org), RBAC
(`viewer<member<admin<owner`), API keys stored as SHA-256 hashes, provider keys encrypted with
AES-256-GCM (`MASTER_KEY`), per-key rate limiting, policy-event audit trail, and an
approval workflow for expensive actions. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §6.

## License

Unlicensed local project (no remote configured). For internal/demo use.
