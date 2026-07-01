# Token Budget Manager — Data Model

## 1. Entities overview

| Table | Purpose |
|---|---|
| `organizations` | Top-level tenant. Everything is scoped to an org. |
| `users` | Members of an org (+ role for RBAC). |
| `api_keys` | Hashed TBM API keys, scoped to org (+ optional project/user). |
| `provider_keys` | Encrypted provider (OpenAI) credentials, per org. |
| `projects` | Workspace/project inside an org. |
| `agents` | A logical agent (bot) belonging to a project. |
| `sessions` | A thread/conversation for an agent (long-running). |
| `tasks` | A unit of work within a session (has priority). |
| `llm_requests` | One LLM call: estimate + status + final model. |
| `token_usage` | Actual usage ledger row per request (input/output/cached/tool). |
| `budgets` | A limit at some level (org…request) with thresholds/policy. |
| `budget_policies` | condition → action rules attached to a budget. |
| `policy_events` | Every enforcement decision (audit + analytics). |
| `approvals` | Pending/approved/denied approval requests. |
| `model_pricing` | Per-model input/output/cached prices + context window. |
| `audit_log` | Generic who/what/when for sensitive mutations. |

## 2. Budget levels & fields

Levels (enum `BudgetLevel`): `ORGANIZATION`, `PROJECT`, `USER`, `AGENT`, `SESSION`, `TASK`,
`TOOL_CALL`, `REQUEST`.

Every `budget` row has:
- `metric`: `TOKENS` | `COST_USD` — what the limit counts.
- `hardLimit`: calls blocked once `used + reserved` would exceed it.
- `softLimit`: `degrade`/`compress` territory (still allowed).
- `warningThreshold` (0–1): fraction of hard limit that triggers `warn`.
- `resetPeriod`: `NEVER` | `HOURLY` | `DAILY` | `WEEKLY` | `MONTHLY` (rolling window start).
- `priority`: integer; higher = more important (throttle low-priority first).
- `fallbackBehavior` (enum `FallbackBehavior`): what to do at the hard limit —
  `BLOCK` | `DEGRADE` | `SUMMARIZE` | `REQUIRE_APPROVAL` | `STOP_AGENT`.

## 3. Hierarchical resolution — most-restrictive-wins

A call carries a **scope chain**: `{organizationId, projectId, userId, agentId, sessionId,
taskId}` (plus the request itself). Resolution:

1. **Collect** all active budgets whose `(level, scopeId)` matches any entry in the chain.
2. For each budget compute `used` (from `token_usage` rollups within its reset window) plus any
   live `reserved` amount, and `projected = used + reserved + thisCallReservation`.
3. Classify each budget:
   - `projected > hardLimit` → **exceeds** (this budget wants to block/fallback).
   - `projected > softLimit` → **soft-exceeded**.
   - `projected > warningThreshold * hardLimit` → **warning**.
4. **Combine (most-restrictive-wins):** the effective decision is the *strongest* action among
   all budgets. Ordering (strongest → weakest):
   `STOP_AGENT/BLOCK > REQUIRE_APPROVAL > TRUNCATE > SUMMARIZE/COMPRESS > DEGRADE > WARN > ALLOW`.
   If **any** budget exceeds its hard limit, the call cannot proceed as-is — its
   `fallbackBehavior` selects among block/degrade/summarize/approval/stop. Ties broken by the
   more specific (deeper) level and then higher `priority`.

This guarantees acceptance criterion #1: if *any* applicable hard budget is exhausted, the
Policy Engine returns a blocking decision and the gateway refuses the call.

### Worked example
Budgets: Org (hard 1,000,000 tokens, 60% used), Agent-A (hard 10,000, 9,900 used), Session
(hard 50,000, 1,000 used). Incoming call reserves 300 tokens.
- Org projected 600,300 < 1,000,000 → allow.
- Agent projected 10,200 > 10,000 → **exceeds** (fallback `BLOCK`).
- Session projected 1,300 < 50,000 → allow.
- Most-restrictive-wins → **block** (agent hard limit). Even though org/session have room.

## 4. Prisma schema

The authoritative schema lives in [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma).
It uses SQLite for the runnable MVP; switch to Postgres by changing the `datasource` provider
to `postgresql` and pointing `DATABASE_URL` at Postgres (enums below are modeled as string
columns with app-level validation so the same schema runs on both engines).

Key relations:
- `Organization` 1—N `User`, `Project`, `ApiKey`, `ProviderKey`, `Budget`, `ModelPricing`(global-or-org).
- `Project` 1—N `Agent`; `Agent` 1—N `Session`; `Session` 1—N `Task`; `Task`/`Session`/`Agent` 1—N `LlmRequest`.
- `LlmRequest` 1—1 `TokenUsage`.
- `Budget` 1—N `BudgetPolicy`, 1—N `PolicyEvent`.
- `Approval` N—1 `LlmRequest` (the call awaiting approval).

## 5. Reservation & idempotency

- A `check-budget` that returns `allow`/soft actions creates an `llm_request` row in status
  `RESERVED` holding `reservedTokens`. Concurrent checks see the reservation in `used+reserved`,
  so parallel agents cannot collectively blow a hard limit (criterion #1 under concurrency).
- `record-usage` is keyed by `llm_request.id`; a second call for the same id is a no-op that
  returns the existing usage row (idempotent → retries don't double-count).
- Reservations that are never finalized expire after `RESERVATION_TTL` (swept lazily on read).

## 6. Indices (perf-critical)
- `token_usage(organizationId, createdAt)`, `(agentId, createdAt)`, `(taskId)` for rollups.
- `llm_requests(sessionId, signature)` for loop/retry detection.
- `budgets(level, scopeId, active)` for resolution collection.
- `policy_events(organizationId, createdAt)` for the dashboard feed.
