# Senior code review — Token Budget Manager

Reviewed at `ac34234` (49 tests passing). Three hats: **software architect**, **AI engineer**,
**product manager**. Every finding points at a real file and line. Effort estimates are for one
engineer who already knows this codebase.

The product is in better shape than most projects at this stage: the enforcement path
(`checkBudget` → reservation → `recordUsage`) is coherent, the tokenizer/pricing split is clean, the
mock provider makes the whole thing runnable offline, and the transparent proxy is a genuinely good
adoption idea. The problems below are concentrated in three places: **multi-tenant trust
boundaries**, **the "hard limits cannot be exceeded" claim under concurrency**, and **budget-level
semantics that silently do something other than what they say**.

---

## Summary table

| ID | Severity | Finding | Effort |
|----|----------|---------|--------|
| P0-1 | P0 | `npm run typecheck` fails on `main` | 5 min |
| P0-2 | P0 | Cross-tenant write via `POST /v1/record-usage` | 20 min |
| P0-3 | P0 | Cross-tenant scope injection via the `scope` body field | 45 min |
| P0-4 | P0 | Reservation race: hard limits *can* be exceeded concurrently | 2–3 h |
| P0-5 | P0 | `REQUEST` / `USER` / `TOOL_CALL` budgets silently aggregate the whole org | 1 h |
| P0-6 | P0 | Shipped `support-desk` pack blocks where it claims to compress | 30 min |
| P1-1 | P1 | `AuditLog` model exists; nothing ever writes to it | 1 h |
| P1-2 | P1 | `routes.ts` is a 580-line god module | 2 h |
| P1-3 | P1 | `resetDb` triplicated across seed / demo / tests | 20 min |
| P1-4 | P1 | Dead code in 4 services | 20 min |
| P1-5 | P1 | Policy-condition matching duplicated and divergent — dry-runs lie | 45 min |
| P1-6 | P1 | `x-tbm-user` parsed then dropped → chargeback-by-user is always empty | 30 min |
| P1-7 | P1 | No RBAC on the endpoints that spend money | 15 min |
| P1-8 | P1 | 500 handler leaks internal error text | 15 min |
| P1-9 | P1 | N+1 in `resolveBudgets`; `activeBudgets` is O(N²) | 1 h |
| P1-10 | P1 | Hot path does a global, all-tenant `updateMany` | 30 min |
| P1-11 | P1 | Testing gaps: RBAC, isolation, concurrency, window boundaries | 3 h |
| P1-12 | P1 | Dashboard is one 338-line file with no token/component layer | 2 h |
| P1-13 | P1 | DX: no root scripts, typecheck not part of any verify gate | 45 min |
| P2-1 | P2 | Rate limiter ignores `Authorization: Bearer` | 15 min |
| P2-2 | P2 | No bounds on `messages[]` size or content length | 30 min |
| P2-3 | P2 | `chooseModel` budget-fit filter is wrong when tokens are tight | 30 min |
| P2-4 | P2 | `req: any` in routes defeats the auth typing | 10 min |
| P2-5 | P2 | Provider abstraction has no tool-calling or streaming surface | 2 h |
| P2-6 | P2 | Product: dashboard is read-only; you must curl to configure the product | 1 d |
| P2-7 | P2 | Product: no approvals queue in the UI although the API has one | 3 h |
| P2-8 | P2 | Product: savings ledger presents estimates as 6-decimal dollars | 2 h |
| P2-9 | P2 | Product: single shared API key in `localStorage`, no users/login | 1 w |

---

# P0 — fix before anyone trusts this with real money

### P0-1 · `npm run typecheck` fails on `main`

`backend/src/services/policyPacks.ts:95` sets `fallbackBehavior: 'COMPRESS'`, which is not a member
of the `PolicyPackBudget['fallbackBehavior']` union declared 80 lines above at
`policyPacks.ts:15`:

```
src/services/policyPacks.ts(95,7): error TS2322: Type '"COMPRESS"' is not assignable to type
'"BLOCK" | "DEGRADE" | "SUMMARIZE" | "REQUIRE_APPROVAL" | "STOP_AGENT" | undefined'.
```

This shipped because `npm test` (vitest, which transpiles without type-checking) is the only gate
anyone runs. `npm run build` is also broken by it, so `npm start` cannot work from a clean checkout.

**Smallest fix:** correct the value (see P0-6 — it is also a behavioural bug) and add a root
`npm run verify` that runs typecheck **and** tests so this class of break is impossible to land.

### P0-2 · Any tenant can finalize another tenant's reservation

`backend/src/routes.ts:189-205` accepts a `requestId` and passes it straight to `recordUsage`.
`backend/src/services/accounting.ts:66-72` looks the request up **by primary key only**:

```66:72:backend/src/services/accounting.ts
export async function recordUsage(input: RecordUsageInput) {
  const request = await prisma.llmRequest.findUnique({
    where: { id: input.requestId },
    include: { usage: true },
  });
  if (!request) throw new Error(`Unknown request ${input.requestId}`);
```

There is no comparison against `req.auth.organizationId`. Any authenticated key can post arbitrary
token counts against **any** organization's reservation, and because `recordUsage` copies
`request.organizationId` onto the new `TokenUsage` row, the write lands in the victim's tenant. That
is a cross-tenant write, a billing-integrity hole, and a denial-of-service on someone else's budget
(inflate their usage until every request blocks). IDs are `cuid()`s, so it needs a leaked or guessed
id — that is obfuscation, not a boundary.

**Smallest fix:** make `organizationId` a required parameter of `recordUsage` and scope the lookup
with `findFirst({ where: { id, organizationId } })`. Internal callers (proxy, gateway) already know
the org.

### P0-3 · Cross-tenant scope injection through the `scope` body field

`scopeSchema` (`backend/src/routes.ts:28-34`) accepts free-form `projectId`, `userId`, `agentId`,
`sessionId`, `taskId` strings, and every consumer merges them into the chain without checking
ownership — `/v1/check-budget:176`, `/v1/llm/complete:230`, `/v1/record-tool-usage:212`,
`/v1/forecast/run:539`. Consequences for a caller who knows a victim's agent id:

- **Read:** `checkBudget` returns the victim's full `budgets[]` array — names, hard limits, current
  utilization. `forecastRun` does the same. That is a tenant-data leak through a normal 200.
- **Write:** the reservation row created at `accounting.ts:33-53` carries `organizationId` from the
  caller's auth but `agentId`/`taskId` from the attacker, so usage is attributed into the victim's
  rollups and their agent-level budget headroom is consumed.
- **Paused-agent bypass in the other direction:** `gateway.ts:79-82` reads the agent by id with no
  org filter, so a paused agent in one tenant pauses nothing for anyone else — but the same
  unfiltered lookup is what makes the leak above work.

**Smallest fix:** one `assertScopeOwnership(organizationId, scope)` helper that verifies each
supplied id resolves inside the org (`project.organizationId`, `agent.project.organizationId`,
`session.agent.project.organizationId`, `task.session.agent.project.organizationId`) and 404s
otherwise. Call it in the four route handlers. The proxy path is already safe because
`resolveScopeFromHeaders` (`services/scope.ts:47`) creates everything under the caller's org.

### P0-4 · The core promise — "hard budgets cannot be exceeded" — is not race-safe

`gateway.checkBudget` reads budget state at `gateway.ts:61` and writes the reservation at
`gateway.ts:114`, with roughly a dozen awaited round-trips in between (`lookupPromptCache`,
`detectLoopSignals`, an agent lookup, `evaluatePolicies` with its own query, `chooseModel`). Nothing
in that window is transactional or serialized. Two concurrent requests against a budget with room
for one both observe headroom, both pass, and both reserve. The comment at `gateway.ts:42-46` claims
this "guarantees hard budgets cannot be exceeded"; today it guarantees it only for a single
in-flight request per scope.

The existing test (`tests/integration.test.ts:89`) issues calls **sequentially**, so it cannot catch
this. Under a real agent swarm — the exact workload this product targets — overshoot is expected,
not exotic.

**Smallest fix (portable, no DB-specific locking):** invert the order into reserve-then-verify.
Insert the reservation first, then re-run `resolveBudgets` with a zero projected amount — the row
just written is now counted in `reserved`, so the arithmetic is *identical* to today's for a single
request, and under concurrency both racers see each other and both step back (conservative, which is
the correct direction to fail for a spend guard). If the re-read shows a hard breach, flip the row to
`blocked` and return the budget's fallback decision. Two extra aggregate reads on the hot path; that
is the right trade for the product's central claim. A stronger fix (per-scope advisory lock or
`SERIALIZABLE`) is Postgres-specific and can come later.

### P0-5 · Three of the eight budget levels do not mean what they say

`budgetEngine.scopeFilter` (`backend/src/services/budgetEngine.ts:53-71`) falls through `USER`,
`TOOL_CALL` and `REQUEST` to `{ organizationId }`:

```64:70:backend/src/services/budgetEngine.ts
    case 'USER':
    case 'TOOL_CALL':
    case 'REQUEST':
    default:
      return { organizationId: chain.organizationId };
```

So a `REQUEST`-level budget aggregates *the entire organization's lifetime usage*. The seed
(`backend/src/seed.ts:117-131`) ships exactly this: "Per-request cost guard", `REQUEST`,
`COST_USD`, `hardLimit: 1.0`, `resetPeriod: 'NEVER'`, `fallbackBehavior: 'REQUIRE_APPROVAL'`. It
reads as "no single call may cost more than $1". It behaves as "after $1 of cumulative org spend,
**every** call needs human approval, forever." Anyone who runs the demo then leaves the server up
hits this and concludes the policy engine is broken.

`USER` is worse in a quiet way: `budgetApplies` (`budgetEngine.ts:86-87`) correctly matches on
`chain.userId`, so the budget is *selected*, and then the usage filter ignores the user entirely and
sums the whole org. Per-user budgets are unenforceable. `TOOL_CALL` sums `totalTokens` rather than
`toolTokens`, so a tool-call budget is really a general token budget.

**Smallest fix:** `REQUEST` → per-call only (`used = 0`, `reserved = 0`; compare the incoming
projection alone). `USER` → filter via the relation (`TokenUsage` has no `userId` column, but
`{ request: { userId } }` works). `TOOL_CALL` → sum `toolTokens` instead of `totalTokens`. All three
are contained inside `computeUsed`/`computeReserved`.

### P0-6 · The shipped `support-desk` pack blocks where its own description promises to compress

`policyPacks.ts:95` and `packs/support-desk-pack.json:30` set the "Per-ticket task tokens" budget's
`fallbackBehavior` to `"COMPRESS"`. `COMPRESS` is not a fallback behavior — the enum is
`BLOCK | DEGRADE | SUMMARIZE | REQUIRE_APPROVAL | STOP_AGENT`. `fallbackToDecision`
(`services/policyEngine.ts:22-35`) has no `COMPRESS` case, so it hits `default:` and returns
`'stop-agent'` — a **blocking** decision. The pack's own description says
*"degrade-before-block for helpdesk / CRM copilots"*; importing it gives you hard-stop-at-8000-tokens
in the middle of a customer ticket.

Two defects in one: the value is invalid (P0-1) *and* `fallbackToDecision`'s `default:` silently
upgrades any unknown string to the single most aggressive decision in the system.

**Smallest fix:** `'DEGRADE'` in both the TS pack and the JSON, and validate `fallbackBehavior`
against the enum in `parsePolicyPack` so an imported third-party pack cannot smuggle an unknown
value into the most restrictive branch.

---

# P1 — cheap, high-value, mostly behaviour-preserving

### P1-1 · The audit log is a lie of omission

`AuditLog` is modelled (`prisma/schema.prisma:271-283`), related from `Organization`, and wiped by
all three reset routines. It is **never written to**. `rg 'auditLog'` returns three `deleteMany`
calls and nothing else. Meanwhile budgets can be raised (`routes.ts:105`), agents paused
(`routes.ts:331`), approvals granted (`routes.ts:361`) and policy packs imported (`routes.ts:493`)
with no record of who did it. For a spend-governance product sold to finance, "who raised this
limit?" is a table-stakes question. **Effort: 1 h** for an `audit.ts` service plus call sites.

### P1-2 · `routes.ts` is a 580-line god module

One file registers budgets, policies, the gateway, optimization helpers, agent lifecycle,
approvals, webhooks, ten analytics endpoints, policy packs, forecasting, simulation and a directory
helper. Two structural smells:

1. **Inconsistent layering.** Analytics and forecasting go through services; budget/policy/webhook
   CRUD reaches straight into `prisma` from the handler. There is no seam to add the audit log
   (P1-1), authorization, or the assistant's tool layer without duplicating logic in both styles.
2. **Zod schemas inline and duplicated.** The budget-policy `action` enum is spelled out twice,
   verbatim, at `routes.ts:139-142` and `routes.ts:553-556`; the chargeback query schema is
   duplicated at `routes.ts:458-462` and `routes.ts:470-474`; `scopeSchema` is re-declared in
   long-hand inside the policy-pack body at `routes.ts:498-507`.

**Smallest fix:** split by concern into `routes/*.ts` with one `registerRoutes` composer, and hoist
the repeated enums/schemas into a shared `schemas.ts`. Pure move — no behaviour change — and it is
what makes P1-1 and the assistant's write tools a one-line change instead of a scavenger hunt.

### P1-3 · `resetDb` exists three times, byte-identical

`seed.ts:23-43` (`resetAll`), `demo.ts:6-26` (`resetDb`) and `tests/helpers.ts:3-23` (`resetDb`) are
the same 19 lines in the same FK order. Adding a model means remembering all three; forgetting one
produces a foreign-key error in whichever surface you did not update. **Effort: 20 min.**

### P1-4 · Dead code

- `services/policySimulation.ts:88-97` — a loop whose body is a single `if` containing only a
  comment saying the work is "handled below". It does nothing. Delete.
- `services/savingsLedger.ts:63-74` — `else if (decision === 'degrade' && req.usage)` is
  **unreachable**: `OPTIMIZING` contains `'degrade'`, so the branch at line 53 always wins. The
  model-pricing-delta logic inside has never run, which is worth knowing before anyone cites the
  savings number in a sales deck.
- `services/analytics.ts:125` — `include: { request: { select: {...} } }` fetches a join whose
  fields are never read by the `map` below it.
- `services/chargeback.ts:101` — `+ (lines.length ? '\n' : '\n')`: both branches are identical.

### P1-5 · Policy conditions are matched by two different, divergent implementations

`policyEngine.conditionMatches` (`policyEngine.ts:43-73`) handles `loop`, `utilization`, `retries`,
`toolCalls`, `requestCost` and all four operators. `policySimulation.ts:110-130` reimplements a
weaker copy that:

- supports only `loop`, `utilization`, `requestcost` — a dry-run of `retries>=3` or `toolCalls>=40`
  silently reports "no change" for a policy that would fire constantly in production;
- ignores the operator for `requestcost` (`m[1]` is captured and never used, so `>` behaves as `>=`);
- always evaluates `utilization` against `budgets[0]` rather than the policy's own budget.

Policy simulation is a flagship differentiator whose whole value is that you can trust it before you
enable a rule. Right now it can tell you a policy is harmless when it would block half your traffic.
**Smallest fix:** export `conditionMatches` and call it. **Effort: 45 min.**

### P1-6 · `x-tbm-user` is parsed and then thrown away

`readScopeHeaders` (`services/scope.ts:83-89`) reads `x-tbm-user` into `ProxyScopeHeaders.user`.
`resolveScopeFromHeaders` (`scope.ts:47-75`) never reads that field, so `chain.userId` is always
undefined for proxy traffic. Downstream: `GET /v1/analytics/chargeback?groupBy=user` returns a single
`(unattributed)` row for every proxied call — the dashboard exposes that button
(`App.tsx:219-228`), so it is a user-visible empty result, and per-user budgets (already broken by
P0-5) have no chance of applying. **Effort: 30 min** — find-or-create a `User` by email/name like
the other `ensure*` helpers.

### P1-7 · No RBAC on the endpoints that actually cost money

`requireRole` exists and is applied to budget/policy/webhook writes. It is **not** applied to
`/v1/check-budget`, `/v1/llm/complete`, `/v1/record-usage`, `/v1/record-tool-usage` or the proxy. A
key minted as `viewer` — the role you would hand to a finance analyst who wants dashboard access —
can call the LLM and spend the org's budget. **Effort: 15 min** (`requireRole('member')`).

### P1-8 · The 500 handler returns internal error text to the client

```20:25:backend/src/server.ts
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', issues: err.issues });
    }
    reply.code(err.statusCode ?? 500).send({ error: err.message });
  });
```

For an unexpected throw this forwards raw text — Prisma errors include table and column names, and
`recordUsage` throws `Unknown request <id>`, which is a tenant-existence oracle. Log the detail
server-side, return a generic message for 5xx, keep messages for deliberate 4xx. **Effort: 15 min.**

### P1-9 · N+1 on the hottest path in the product

`resolveBudgets` (`budgetEngine.ts:147-152`) loops over applicable budgets and awaits
`computeUsed` **and** `computeReserved` sequentially: `2N + 1` queries per LLM call, serialized.
With the seed's three budgets that is 7 round-trips before any policy is even evaluated.

`analytics.activeBudgets` (`analytics.ts:81-102`) is quadratic on top: it fetches every budget, then
calls `resolveBudgets` **once per budget**, each of which re-fetches every budget and runs its own
`2N` aggregates — and the dashboard polls this endpoint every 5 seconds (`App.tsx:98`).

**Smallest fix now:** `Promise.all` the per-budget work so the round-trips overlap (one-line change,
no semantics change). **Proper fix later:** group budgets by `(level, scopeId, metric, window)` and
issue one aggregate per distinct group; give `activeBudgets` a bulk path.

### P1-10 · Every budget check does a global, all-tenant write

`resolveBudgets` calls `expireStaleReservations()` on line 141, which is
`updateMany({ where: { status: 'reserved', createdAt: { lt: cutoff } } })` with **no
`organizationId`** (`accounting.ts:10-17`). So every check-budget in any tenant writes rows in every
other tenant, and the server already runs the same sweep on a timer (`server.ts:40-46`). It is not a
data leak, but it is a cross-tenant write on the hot path and a lock-contention source on Postgres.
Scope the sweep to the org, keep the global sweep on the timer. **Effort: 30 min.**

### P1-11 · Testing gaps, ranked by what actually matters

49 tests is respectable coverage of the happy path. What is missing is exactly the set that would
have caught the P0s:

1. **No multi-tenant isolation test at all.** Nothing creates two orgs and asserts that org A cannot
   read or write org B's budgets, requests, agents or usage. P0-2 and P0-3 would both have failed a
   ten-line test.
2. **No concurrency test.** Every enforcement test is a sequential `for` loop. `Promise.all` of N
   simultaneous `llm/complete` calls against a small budget is the single highest-value test this
   repo does not have (P0-4).
3. **No RBAC test.** `requireRole` is untested; the one auth test (`integration.test.ts:113-118`)
   only covers a missing key. No 403 assertion exists anywhere.
4. **No budget-level semantics tests.** `REQUEST`, `USER` and `TOOL_CALL` levels have zero coverage,
   which is why P0-5 shipped in the seed data.
5. **`resetWindowStart` boundaries untested** — the DST and week-start behaviour of
   `budgetEngine.ts:27-50` is where reset-period bugs live, and it is pure and trivial to test.
6. **Policy-pack import is untested end-to-end** — no test asserts that an imported pack produces
   budgets that actually enforce, which is why P0-6 shipped.
7. **The dashboard has no tests and no test runner.** Not worth a full harness yet, but
   `npm run build` in `dashboard/` must at least be part of the verify gate.

### P1-12 · The dashboard is one 338-line file with no design-token or component layer

`App.tsx` holds ten `useState` hooks, the polling loop, the settings form, and six presentational
primitives (`Card`, `Stat`, `UtilBar`, `Badge`, `Table`, `EventList`) defined below the component
that uses them. Concretely:

- The palette is inlined as Tailwind literals in ~40 places (`bg-white`, `text-slate-500`,
  `bg-amber-50`) plus a hand-maintained `decisionColor` map at `App.tsx:44-54`. There is no `cn()`
  helper and `tailwind.config.js` has an empty `theme.extend`, so there is nothing to change when the
  palette changes.
- `App.tsx:70` uses an inline `import('./api').SavingsLedger` type because the named import list at
  the top was not updated — a small sign the file has outgrown its shape.
- Severity is communicated by colour alone (`App.tsx:200`, the `decisionColor` map), which is an
  accessibility problem as soon as a real customer with a colour-vision deficiency looks at it.

**Smallest fix:** extract the primitives into `components/`, add a `cn()` helper and semantic tokens
(`surface`, `border`, `muted`, `accent`, `warn`, `danger`, `ok`) to `theme.extend`, and pair every
colour with text or an icon.

### P1-13 · DX / onboarding friction

- **No root `package.json`.** Every command in the README starts with `cd backend` or
  `cd dashboard`. There is no single `npm run verify`, which is precisely why P0-1 landed.
- **Typecheck is not in any gate.** `npm test` passes on code that does not compile.
- **No CI config** of any kind, so the above is only enforced by memory.
- `backend/.env` is required for local runs but is gitignored and undocumented as a *separate* file
  from the root `.env.example` — the README's quick start works only because `config.ts:5` defaults
  `DATABASE_URL` to `file:./dev.db`. That is a latent surprise, not a break.

---

# P2 — worth doing, not urgent

- **P2-1 · Rate limiter ignores the proxy's auth header.** `server.ts:17` keys on `x-api-key` only;
  OpenAI SDKs send `Authorization: Bearer`, so all proxy traffic — the flagship integration path —
  buckets by IP and a single NAT'd customer can starve the others.
- **P2-2 · No bounds on request size.** `messageSchema` (`routes.ts:36`) accepts unbounded
  `content` and unbounded array length; `role` is `z.string()` rather than an enum. The proxy types
  its body as `any` (`routes/proxy.ts:70`) and hands it to `estimateTokens`, so a single large body
  is a CPU amplification vector through tiktoken.
- **P2-3 · `chooseModel`'s budget filter is wrong when tokens are tight.** `optimization.ts:100-104`
  recomputes a candidate-invariant `tokensOk` inside the `filter`; when the token budget does not fit,
  it evaluates false for *every* candidate, `budgetFit` empties, and the function reports
  `fitsRemainingBudget: false` even though switching models could never have helped tokens anyway.
  Hoist the invariant and report the two constraints separately.
- **P2-4 · `const org = (req: any)`** at `routes.ts:443` throws away the `FastifyRequest.auth`
  typing that `auth.ts:11-15` declares, for ten call sites.
- **P2-5 · The provider abstraction cannot express tool calls or streaming.**
  `providers/types.ts:23-26` is `complete(req, apiKey)` returning `{ content, model, usage }`. Any
  agentic feature — including the assistant in this repo's next milestone — needs `tools`,
  `tool_choice` and `tool_calls` on the response, plus a streaming variant. The proxy works around
  this with its own `upstream.ts`, so there are now two parallel provider paths
  (`providers/openai.ts` and `services/upstream.ts`) that both build OpenAI request bodies.

## Product hat

- **P2-6 · The dashboard cannot configure the product.** It renders ten analytics panels and offers
  exactly two actions: download a CSV and import a built-in pack. Creating a budget, editing a
  hard limit, or writing a policy all require `curl`. A buyer evaluating this in a 30-minute trial
  will conclude it is a reporting tool, not a control plane — which undersells the actual
  enforcement engine underneath.
- **P2-7 · Approvals exist in the API and nowhere in the UI.** `REQUIRE_APPROVAL` is a documented
  fallback, `/v1/approvals` lists pending items, signed one-click links are implemented
  (`events.ts:201-208`) — and the dashboard has no approvals queue. A blocked request is therefore a
  dead end for anyone not reading Slack.
- **P2-8 · The savings ledger's credibility is undersold by its own precision.** It renders
  counterfactual estimates as `$0.001234` (`App.tsx:12`, six decimals), and the branch that would
  have computed the model-downgrade delta is dead code (P1-4). The methodology note exists
  (`savingsLedger.ts:130`) but is rendered as 12px grey text at the bottom of the card. A CFO who
  spots one implausible number discards the whole panel. Round to cents, label it "estimated", and
  show the method inline.
- **P2-9 · No users, no login, one shared key.** `api.ts:5` defaults every browser to the
  hard-coded `tbm_demo_local_key` in `localStorage`. The `User` and `ApiKey` models and the
  four-level `ROLE_RANK` are all there, but there is no way to create a key, rotate one, or see who
  is using which. That is the gap between "works" and "procurement will approve it".
- **What a new user is missing most:** nothing in the product answers *"what do I do about this?"*
  A warning shows a utilization bar; a block shows a reason string. There is no next action, no
  explanation of which policy fired and why, and no way to ask. That is the gap the in-product
  assistant is meant to close — and it is also why the assistant must be able to *act*, not just
  answer.

---

## What was fixed in this pass

Implemented in the commit immediately following this document (`fix(p0/p1)`):

- **P0-1** typecheck restored; `npm run verify` added at the repo root.
- **P0-2** `recordUsage` is now tenant-scoped and every caller passes its org.
- **P0-3** `assertScopeOwnership` guards all four scope-accepting routes.
- **P0-4** reserve-then-verify closes the reservation race; covered by a new concurrency test.
- **P0-5** `REQUEST` is per-call, `USER` filters by user, `TOOL_CALL` sums tool tokens.
- **P0-6** pack fallback corrected in TS + JSON, and `parsePolicyPack` now validates the enum.
- **P1-1** `services/audit.ts` + call sites (and every assistant tool call).
- **P1-2** `routes.ts` split into `routes/*` with shared `schemas.ts`.
- **P1-3** one `resetDatabase()` used by seed, demo and tests.
- **P1-4** dead code removed in all four services.
- **P1-5** `conditionMatches` shared between the engine and the simulator.
- **P1-6** `x-tbm-user` resolves a real `User` and populates `chain.userId`.
- **P1-7** `requireRole('member')` on the spending endpoints.
- **P1-8** 5xx responses no longer echo internal error text.
- **P1-9** per-budget work parallelised (the grouped-aggregate rewrite is deferred).
- **P1-10** hot-path reservation sweep scoped to the tenant.
- **P1-11** isolation, RBAC, concurrency, budget-level and reset-window tests added.
- **P1-12** `cn()` + semantic tokens + extracted components (full palette migration deferred).
- **P1-13** root scripts and a single verify gate.

**Deferred, with reasons:** P2-1 through P2-5 and P2-9 are real but none of them is on the path to a
trustworthy spend guard this week; P2-5 is partially addressed because the assistant needed
tool-calling, so `providers/types.ts` gained an optional `chat()` surface rather than a rewrite.
P2-6/P2-7/P2-8 are product scope that the assistant panel now partly covers — the assistant can
create a budget, raise a limit (with confirmation) and approve a request in natural language, which
is a faster path to "the dashboard can configure the product" than building every CRUD form.
