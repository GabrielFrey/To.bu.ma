# The in-product AI assistant

A tool-calling agent inside Token Budget Manager. It answers questions about
spend and it changes configuration, using the same service layer the REST API
uses. Its own LLM calls go through this product's gateway, so it is budgeted,
metered and blockable exactly like the agents it manages.

Two claims are worth checking before trusting anything below, and both are
asserted by tests: **every** tool call is audited with tenant and actor, and the
assistant can be stopped by its own budget.

---

## 1. Architecture

```
POST /v1/assistant/chat            dashboard (Assistant tab) / SDK / curl
POST /v1/assistant/chat/stream
        |
        v
assistant/runner.ts ──► assistant/llm.ts ──► checkBudget() ──► provider.chat()
   turn orchestration      metered turn         (gateway)      (mock | openai)
        |                                            |
        |                                            └──► recordUsage()
        |                                                  TokenUsage rows
        v
assistant/tools.ts ──► services/* (analytics, budgets, policies, forecast,
   26 tools, risk           simulation, savings, chargeback, packs, approvals)
   classification
        |
        ├──► assistant/confirm.ts    HMAC confirm tokens for gated calls
        └──► services/audit.ts       one AuditLog row per tool call
        v
AssistantConversation / AssistantMessage / AssistantToolCall  (per tenant)
```

| File | Responsibility |
| --- | --- |
| `assistant/routes.ts` | HTTP surface, request validation, RBAC (`member`+) |
| `assistant/runner.ts` | The turn loop: LLM step → tool calls → gate → next step → answer |
| `assistant/tools.ts` | Tool registry, Zod schemas, risk classification, handlers |
| `assistant/confirm.ts` | Mint/verify confirmation tokens |
| `assistant/llm.ts` | One metered LLM turn through the gateway |
| `assistant/identity.ts` | The `tbm-assistant` project/agent/budget per tenant |

### The turn loop

1. Load the conversation transcript (tenant-scoped) and append the user message.
2. Ask the provider for the next step, passing the tool specs. **This call goes
   through `checkBudget()` first and `recordUsage()` after** — see §4.
3. If the model returned tool calls, classify each one:
   - not gated → execute, append the result to the transcript, loop;
   - gated → persist it as `pending_confirmation`, mint a token, stop the turn
     and return the prompt to the caller.
4. If the model returned text, that is the answer. Persist and return.
5. Stop after `TBM_ASSISTANT_MAX_STEPS` provider round-trips (default 6) so a
   confused model cannot bill a loop.

Tool results are truncated before they re-enter the prompt: an 8k-row chargeback
CSV must not dominate the next step's token bill.

### Streaming

`POST /v1/assistant/chat/stream` emits the same turn as SSE:
`conversation`, `usage`, `tool_call`, `tool_result`, `pending_confirmation`,
`delta`, `blocked`, `done`, `end`. The `done` frame carries the identical payload
as the non-streaming route, so a client can ignore the intermediate frames.

Ordering guarantee the dashboard relies on: the `usage` frame for a step is
emitted **before** the `tool_call` frames that step produced, which is how each
tool card can show the token cost of deciding to make that call.

---

## 2. Tool registry

26 tools. Risk classes:

- **read** — no state change. Runs immediately.
- **write** — bounded change that constrains or reduces spend, or adds
  something (a budget, a policy, a pause). Runs immediately, always audited.
- **destructive** — removes a guardrail, raises a limit, releases spend, or
  changes many objects at once. Requires a confirm-token round-trip.

`confirmation = conditional` means the risk class is computed from the
*arguments*, not the tool name: lowering a hard limit executes, raising the same
limit stops and asks. A classifier may escalate risk; it can never downgrade a
tool declared destructive.

### Read (17) — never gated

| Tool | What it answers |
| --- | --- |
| `get_spend_summary` | Total tokens, cost and request count |
| `get_spend_by_agent` | Spend per agent, highest first |
| `get_spend_by_task` | Spend per task — per-ticket unit economics |
| `get_cost_per_task` | Average cost per completed task |
| `list_budgets` | Every budget with level, limit, utilization, fallback |
| `list_policies` | Policies per budget: condition, action, priority |
| `get_savings_ledger` | Counterfactual savings from enforcement |
| `list_blocked_requests` | What was blocked/held/rate-limited, and why |
| `list_warnings` | Recent warn / degrade / compress events |
| `list_loops` | Sessions repeating the same prompt |
| `list_agents` | Agents and their paused state |
| `list_pending_approvals` | Approvals awaiting a human |
| `get_recommendations` | Heuristic optimization advice |
| `list_policy_packs` | Built-in packs available to import |
| `forecast_run` | Whether an N-step run fits the budgets |
| `simulate_policies` | Dry-run a policy against history; persists nothing |
| `export_chargeback_csv`, `get_chargeback_report` | Finance chargeback |

### Write (5)

| Tool | Confirmation | Why |
| --- | --- | --- |
| `create_budget` | never | Adding a budget only ever constrains spend |
| `pause_agent` | never | Stops spend immediately; trivially reversible |
| `create_policy` | **conditional** | Gated when the action is `ALLOW`, which weakens enforcement instead of adding to it |
| `update_budget` | **conditional** | Gated when it raises a hard limit or deactivates the budget |
| `approve_request` | **conditional** | Gated above `TBM_ASSISTANT_APPROVAL_USD_LIMIT` (default $1) |

### Destructive (3) — always gated

| Tool | Why |
| --- | --- |
| `delete_budget` | Removes a spend guardrail, along with its policies |
| `resume_agent` | A human paused it deliberately; un-pausing releases spend |
| `import_policy_pack` | Creates several budgets and policies in one shot |

### The exact gated list

```
always:      delete_budget, resume_agent, import_policy_pack
conditional: create_policy, update_budget, approve_request
```

`GET /v1/assistant/tools` returns this at runtime, so the UI and the docs cannot
drift apart.

---

## 3. Confirmation gate

The token is an HMAC-SHA256 over `organizationId | toolCallId | tool |
sha256(canonical args) | expiry`, keyed by the app secret, formatted
`<expiryMs>.<hex>`. Consequences:

- It cannot be moved to another tenant.
- It cannot be retargeted at different arguments after the operator was shown a
  summary — changing one argument invalidates it.
- It expires (`TBM_ASSISTANT_CONFIRM_TTL_MS`, default 10 minutes).
- It is single-use: the `AssistantToolCall` row moves out of
  `pending_confirmation`, and comparison is constant-time.

Round trip:

```bash
# 1. Ask for something destructive → the turn stops
curl -sX POST localhost:4000/v1/assistant/chat \
  -H 'x-api-key: tbm_demo_local_key' -H 'content-type: application/json' \
  -d '{"message":"delete the budget named \"Org monthly tokens\""}'
# → stoppedBecause: "awaiting_confirmation",
#   pendingConfirmations[0].confirm.{confirmToken,reason,expiresAt}

# 2. Confirm (or refuse with approve:false, which lets the agent continue)
curl -sX POST localhost:4000/v1/assistant/chat \
  -H 'x-api-key: tbm_demo_local_key' -H 'content-type: application/json' \
  -d '{"conversationId":"<id>","confirmations":[
        {"toolCallId":"<id>","confirmToken":"<token>","approve":true}]}'
```

### Audit

Every tool call writes an `AuditLog` row — executed, pending, denied, expired or
errored — with `organizationId`, the action `assistant.tool.<name>`, and an actor
naming **both** the human API key and the conversation:

```
actor = "apikey:<id> via assistant:<conversationId>"
```

"The assistant did it" is never the whole answer to who did it.

---

## 4. Dogfooding: the assistant pays for itself

Each tenant gets, created on first use:

- project `TBM Internal`, agent **`tbm-assistant`**;
- an `AGENT`-level monthly token budget (`TBM_ASSISTANT_BUDGET_TOKENS`, default
  200,000).

Every assistant LLM turn runs `checkBudget()` → `provider.chat()` →
`recordUsage()` — the same path as the transparent proxy. So:

- its tokens show up in `GET /v1/analytics/by-agent` and the dashboard;
- org-wide budgets constrain it alongside your own agents;
- shrinking its budget **blocks it**, and it says so instead of failing opaquely;
- `pause_agent` on `tbm-assistant` stops it.

`GET /v1/assistant/spend` is the dedicated view, also rendered beside the chat.

Sections 10f–10g of `npm run demo` demonstrate all of this offline.

---

## 5. Voice (browser only)

`dashboard/src/hooks/useVoice.ts` — no keys, no services, no dependencies. The
browser's own `SpeechRecognition` for dictation and `speechSynthesis` for
replies.

- **Push-to-talk**: hold the mic button (pointer) or hold Space/Enter while it is
  focused — it is a real `<button>`, so keydown starts and keyup stops.
- **Hands-free**: a toggle. Chrome ends a recognition session on every pause even
  with `continuous = true`, so the hook re-arms itself until you switch it off.
  Each final utterance is submitted automatically.
- **Live interim transcript** in an `aria-live` region.
- **Barge-in**: playback is cancelled on the recognition engine's `speechstart`,
  so you can talk over the assistant.
- **Languages**: `en-US` and `ru-RU`, applied to both recognition and synthesis;
  the choice and the speak-replies preference persist in `localStorage`.
- **Speakable text**: code fences, inline code and markdown punctuation are
  stripped before speaking, because ids and JSON read terribly out loud.

### Where it degrades

| Browser | Dictation | Spoken replies | Result |
| --- | --- | --- | --- |
| Chrome, Edge, Chromium | yes | yes | full experience |
| Safari (`webkitSpeechRecognition`) | yes | yes | full experience |
| **Firefox** | **no** | yes | mic hidden; a notice explains dictation is unavailable; text chat and spoken replies work |
| No Web Speech at all | no | no | text chat only, with a notice |

Nothing is disabled beyond the missing capability, and no user-agent sniffing is
involved — the hook feature-detects and reports `support.recognition` /
`support.synthesis`.

Other handled cases: a denied mic permission explains itself; `no-speech` and
`aborted` are ignored rather than surfaced as errors (they are routine in
hands-free mode); leaving hands-free mode releases the mic.

### Accessibility

- Keyboard push-to-talk (Space/Enter on the focused mic) plus **Ctrl+Shift+M** to
  toggle listening from anywhere.
- `aria-live` regions for the interim transcript and for agent progress, so
  neither steals focus.
- Focus moves to the confirmation prompt when a turn stops for approval — the
  turn cannot proceed until it is answered.
- Every state has a text label and an icon; colour is never the only signal.
- All animation carries `motion-reduce:animate-none` for
  `prefers-reduced-motion`.

---

## 6. Enabling a real provider

Offline is the default: `TBM_ASSISTANT_PROVIDER=mock` gives deterministic,
keyword-driven tool calls, which is what the tests and the demo use.

```bash
export TBM_ASSISTANT_PROVIDER=openai
export TBM_ASSISTANT_MODEL=gpt-4o-mini        # any tool-calling model
export OPENAI_API_KEY=sk-...                  # or an encrypted provider key row
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `TBM_ASSISTANT_PROVIDER` | `mock` | `mock` or `openai` |
| `TBM_ASSISTANT_MODEL` | `gpt-4o-mini` | Model for the assistant's own turns |
| `TBM_ASSISTANT_BUDGET_TOKENS` | `200000` | Default monthly budget for `tbm-assistant` |
| `TBM_ASSISTANT_MAX_STEPS` | `6` | Provider round-trips per user turn |
| `TBM_ASSISTANT_CONFIRM_TTL_MS` | `600000` | Confirmation token lifetime |
| `TBM_ASSISTANT_APPROVAL_USD_LIMIT` | `1` | Above this, `approve_request` needs confirmation |

Tool JSON schemas are generated from the Zod schemas the tools already declare
(`zodToJsonSchema` in `tools.ts`, ~40 lines), so there is no second definition to
keep in sync and no schema-converter dependency.

---

## 7. Limitations

Honest list.

- **The mock provider is a keyword planner, not a model.** It maps phrases to
  canned tool calls. It exercises the loop, the gate and the accounting
  faithfully, but it will not understand a paraphrase the way a real model does.
  Anything about assistant *quality* has to be judged with a real key.
- **`delta` is one frame, not a token stream.** The provider abstraction does not
  yet expose incremental completions, so the streaming route streams tool
  activity in real time and delivers the final text in a single frame.
- **No `messages[]` compaction.** Long conversations grow the prompt until
  `assistantMaxSteps` or the budget stops the turn. Tool results are truncated;
  the transcript is not summarized.
- **Tool coverage is read-heavy by design.** Writes cover budgets, policies,
  agent pause/resume, approvals and pack import. There is no tool to create
  projects, agents, API keys or webhooks, and none to delete a policy.
- **`simulate_policies` cannot replay tool-call volume**, so simulated
  `TOOL_CALL`-level effects are approximate (same caveat as the REST endpoint).
- **Name resolution is fuzzy.** Budgets and agents resolve by exact
  case-insensitive name, then by substring. With two similar names the assistant
  can pick the wrong one — which is part of why every destructive call shows the
  resolved target in its confirmation prompt before running.
- **The gate protects actions, not reads.** Any `member` key can ask the
  assistant for any spend data in its own tenant; per-project read scoping does
  not exist yet.
- **Voice is browser-grade.** Recognition accuracy, available voices and
  latency are entirely the browser's, offline dictation is not possible in
  Firefox at all, and there is no wake word.
- **One turn per request.** The client sends a message and gets one answer or one
  confirmation prompt; the server never keeps working in the background.
