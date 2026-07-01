# TBM — Zapier / Make integration spec

A full published Zapier/Make app is out of scope; this is the mapping to build one (or to wire
up today using the generic **Webhooks by Zapier** / Make **HTTP** + **Custom Webhook** modules,
which work with TBM immediately).

Base URL: `https://<your-tbm-host>` · Auth: header `x-api-key: <tbm_key>` (REST) or
`Authorization: Bearer <tbm_key>` (proxy). Content-Type: `application/json`.

## Triggers (TBM → Zapier/Make, via webhooks)

Register a TBM webhook pointing at the platform's catch-hook URL:

```
POST /v1/webhooks
{ "kind": "generic", "url": "<zap/make catch-hook URL>", "events": "all" }
```

TBM POSTs a signed envelope `{ id, type, createdAt, data }` with headers `X-TBM-Event` and
`X-TBM-Signature: sha256=<hmac>` (verify with the channel `secret`).

| Trigger (event `type`) | Fires when | Key `data` fields |
|---|---|---|
| `warning_threshold` | budget crosses warning % | `budgetName`, `utilization` |
| `soft_limit_crossed` | soft limit exceeded (degrade/compress) | `budgetName`, `decision` |
| `hard_limit_blocked` | request blocked at hard limit | `budgetName`, `reason` |
| `approval_required` | expensive action needs approval | `approvalId`, `approveUrl`, `denyUrl`, `reason` |
| `approval_resolved` | approval approved/denied | `approvalId`, `status` |
| `loop_stopped` | useless loop stopped | `reason` |
| `agent_paused` / `agent_resumed` | agent state change | `agentId` |

- **Zapier:** *Webhooks by Zapier → Catch Hook*.
- **Make:** *Webhooks → Custom webhook*.

## Actions (Zapier/Make → TBM, REST calls)

| Action | Method & path | Body / notes |
|---|---|---|
| Create budget | `POST /v1/budgets` | `{ name, level, scopeId?, metric, hardLimit, softLimit?, warningThreshold?, resetPeriod?, fallbackBehavior? }` |
| Update budget | `PATCH /v1/budgets/:id` | any budget fields (e.g. raise `hardLimit`) |
| List budgets | `GET /v1/budgets` | — |
| Check budget (pre-flight) | `POST /v1/check-budget` | `{ model, messages, expectedCompletionTokens?, scope? }` → `{ allowed, decision, forecast }` |
| Get spend (total) | `GET /v1/analytics/total` | totals |
| Get spend by agent/task/project | `GET /v1/analytics/by-agent` \| `by-task` \| `by-project` | breakdowns |
| Approve / deny | `POST /v1/approvals/:id/approve` \| `/deny` | or the one-click `approveUrl`/`denyUrl` from the event |
| Budgeted LLM call | `POST /v1/chat/completions` | OpenAI-compatible; Bearer auth; `X-TBM-*` scope headers |

- **Zapier:** *Webhooks by Zapier → POST/GET/Custom Request*.
- **Make:** *HTTP → Make a request*.

## Example: "Slack me + raise budget when an agent is blocked"

1. **Trigger** — Catch Hook receiving TBM `hard_limit_blocked`.
2. **Filter** — continue only if `type == hard_limit_blocked`.
3. **Action** — Slack: post `data.reason`.
4. **Action (optional)** — `PATCH /v1/budgets/{id}` to bump `hardLimit` after human OK.

## Example: "Human approval in Slack"

1. **Trigger** — Catch Hook receiving `approval_required`.
2. **Action** — Slack message with buttons linking to `data.approveUrl` / `data.denyUrl`
   (one-click, signed — no API key needed).
