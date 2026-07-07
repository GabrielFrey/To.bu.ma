# Token Budget Manager — Differentiation Strategy

> Companion to [`COMPETITIVE_ANALYSIS.md`](./COMPETITIVE_ANALYSIS.md). Specifies moat features,
> implementation status, and honest competitive positioning.

## 1. Ranked moat features (impact × feasibility)

| Rank | Feature | Impact | Feasibility | Status | Competitor closest |
|:---:|---|:---:|:---:|---|---|
| 1 | **8-level hierarchical hard budgets + reservations** | ★★★★★ | ★★★★☆ | ✅ Shipped | LiteLLM (4-level), TrueFoundry (rules) |
| 2 | **Agent loop detection → stop-agent** | ★★★★☆ | ★★★★★ | ✅ Shipped | costfuse, AgentBudget |
| 3 | **Run-level predictive overflow** | ★★★★★ | ★★★★☆ | ✅ Shipped | Runcap (partial), no hierarchy |
| 4 | **Savings ledger (counterfactual ROI)** | ★★★★☆ | ★★★☆☆ | ✅ Shipped | None integrated |
| 5 | **Policy simulation / dry-run** | ★★★★☆ | ★★★☆☆ | ✅ Shipped | TrueFoundry audit_mode, Orb pricing sim |
| 6 | **Price-aware degrade under budget** | ★★★☆☆ | ★★★★☆ | ⚠️ Partial (`chooseModel`) | Portkey, Martian |
| 7 | **Portable policy packs** | ★★★☆☆ | ★★☆☆☆ | 📋 Deferred | — |
| 8 | **Chargeback / showback exports** | ★★★☆☆ | ★★★☆☆ | ⚠️ Partial (analytics) | TrueFoundry, Orb |

---

## 2. Feature specifications

### 2.1 Hierarchical reservation-based hard enforcement (shipped)

**Problem:** Flat per-key budgets cannot express "this agent's session may spend $2 but the org may spend $10k."

**Solution:**
- Budget levels: `ORGANIZATION → PROJECT → USER → AGENT → SESSION → TASK → TOOL_CALL → REQUEST`
- **Most-restrictive-wins** across all applicable budgets
- **Reservations** on `check-budget` so concurrent agents cannot race past a hard limit
- Decisions returned to caller: allow / warn / degrade / compress / summarize / truncate / require-approval / stop-agent / retry-limit / tool-limit

**API:** `POST /v1/check-budget`, transparent proxy `POST /v1/chat/completions`

**Differentiator vs LiteLLM/Portkey:** Agent-native scope chain, not just API key / workspace.

---

### 2.2 Agent loop economics (shipped)

**Problem:** Agents repeat identical prompts without progress, burning budget.

**Solution:**
- Request signature = `hash(normalized prompt + model)`
- Per session: count identical signatures; per task: count failed attempts
- Built-in policies fire `stop-agent` / `retry-limit` before upstream call

**API:** Automatic in `check-budget`; analytics at `GET /v1/analytics/loops`

**Differentiator vs observability tools:** Enforcement in request path, not dashboard-only.

---

### 2.3 Run-level predictive overflow (shipped — flagship)

**Problem:** Per-request checks approve step 1 of a 20-step plan that collectively exceeds the task budget.

**Solution:** `POST /v1/forecast/run` accepts:
```json
{
  "scope": { "agentId": "...", "sessionId": "...", "taskId": "..." },
  "model": "gpt-4o-mini",
  "estimatedSteps": 20,
  "avgPromptTokens": 800,
  "avgCompletionTokens": 256,
  "toolCallsPerStep": 1,
  "avgToolTokens": 50
}
```

Returns:
- `projectedRunTokens`, `projectedRunCostUsd`
- `currentUsed`, `remainingAtTightestBudget`
- `willExceedHardLimit`, `stepsUntilHardLimit` (estimated)
- `limitingBudget` — which budget in the hierarchy binds first
- `recommendation` — proceed / reduce steps / downgrade model / abort

**Algorithm:**
1. Resolve applicable budgets at current utilization (no new reservation)
2. Project total run cost = steps × (prompt + completion + tool) priced per model
3. Compare `used + reserved + projectedRun` against each hard limit
4. Report tightest binding budget and steps-until-overflow using linear per-step burn rate

**Demo:** Section 7 in `npm run demo`

---

### 2.4 Savings ledger — counterfactual ROI (shipped — flagship)

**Problem:** Finance asks "what did compression/degrade/loop-stop actually save?" Dashboards show spend, not *avoided* spend.

**Solution:** `GET /v1/analytics/savings-ledger` aggregates counterfactuals:

| Decision | Counterfactual baseline | Saved |
|---|---|---|
| `stop-agent` (loop/hard) | `estimatedCostUsd` on blocked request | full estimate |
| `retry-limit` | same | full estimate |
| `degrade` | cost at originally requested model | delta vs actual |
| `compress` / `summarize` | cost at pre-compression token count (stored estimate) | heuristic 15–40% |
| `allow` with no modification | 0 | 0 |

Also returns:
- `totalSavedUsd`, `totalSavedTokens`
- `byDecision` breakdown
- `topPolicies` — policies that drove the most savings

**Implementation:** Computed on read from `llm_requests` + `token_usage` + `policy_events` (no new table in MVP).

**Demo:** Section 8 in `npm run demo`

---

### 2.5 Policy simulation / dry-run (shipped)

**Problem:** Operators fear enabling a new `stop-agent` policy will block legitimate traffic.

**Solution:** `POST /v1/policies/simulate`
```json
{
  "budgetId": "...",
  "hypotheticalPolicies": [
    { "name": "tight loop stop", "condition": "loop", "action": "STOP_AGENT", "priority": 10 }
  ],
  "lookbackHours": 168,
  "sampleLimit": 500
}
```

Replays historical `llm_requests` through `evaluatePolicies` with synthetic policies merged, **without persisting**. Returns:
- `sampleSize`, `wouldBlock`, `wouldDegrade`, `wouldWarn`
- `projectedSavingsUsd` — sum of counterfactual on would-block
- `examples` — up to 5 requests that would change outcome

**Differentiator vs TrueFoundry audit_mode:** Retrospective simulation on *your* traffic, not just forward audit.

---

### 2.6 Price-aware routing under budget (partial)

**Shipped:** `chooseModel` picks cheapest model fitting context window when policy returns `degrade`.

**Deferred:** Quality-tier constraints ("only downgrade within same capability band"), embedding-based task classification.

---

### 2.7 Portable policy packs (deferred)

Export/import JSON bundles of `budgets` + `budget_policies` for marketplace sharing. Schema-ready; UI/API deferred.

---

### 2.8 Chargeback exports (partial)

**Shipped:** `by-agent`, `by-task`, `by-project` analytics.

**Deferred:** Scheduled CSV/S3/webhook chargeback, FinOps GL code mapping.

---

## 3. Integration surfaces

| Surface | Differentiators exposed |
|---|---|
| REST API | `/forecast/run`, `/analytics/savings-ledger`, `/policies/simulate` |
| Dashboard | Savings ledger card, run forecast widget |
| SDK | `forecastRun()`, `getSavingsLedger()` (TS/Python — follow-up) |
| Demo | Sections 7–8 showcase forecast + savings |
| Proxy | Loop stop + hard block automatic |

---

## 4. Engineering trade-offs

- **SQLite reservations vs Redis:** Correct for single-node; LiteLLM/TrueFoundry use Redis for multi-pod atomicity. Documented scale path.
- **Savings counterfactuals are estimates:** Degrade savings use model pricing delta; compress uses reserved-vs-actual heuristic. Label as "estimated savings" in UI.
- **Simulation replays check-time context:** Does not re-tokenize historical prompts; uses stored `promptTokens`/`estimatedCostUsd`.

---

## 5. What we explicitly do NOT claim

1. Deepest eval/tracing (Langfuse, Braintrust, Galileo win)
2. Broadest provider routing (LiteLLM, Portkey win)
3. Customer billing/invoicing (Stripe, Orb, Metronome win)
4. Only product with hard budget blocks (false — see competitive matrix)
5. Semantic compression (embedding-based — deferred)

---

## 6. Roadmap (post-MVP)

1. Redis reservation store for multi-node
2. SDK methods for forecast + savings
3. Policy pack import/export API
4. Chargeback CSV + webhook schedules
5. Quality-aware model routing tiers
