# TBM Integration Guide

TBM embeds into any business process. This guide covers every integration surface. The
fastest path for existing OpenAI apps is the **drop-in proxy**.

## 1. Drop-in OpenAI-compatible proxy (recommended)

See the [README "Drop-in integration"](../README.md#drop-in-integration--transparent-openai-compatible-proxy)
section for copy-paste examples. Summary:

- Set `base_url = http://<host>/v1` and `api_key = <tbm_key>` in any OpenAI SDK.
- Endpoints: `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings` (+ streaming).
- Attribution via `X-TBM-Project|Agent|Session|Task|User` headers (find-or-create by name).
- Enforcement returns OpenAI-style `402`/`429` errors before forwarding; `degrade` swaps the
  model; `compress`/`truncate` rewrite messages; usage is recorded from the response.

**Trade-off — proxy vs SDK:** the proxy is zero-code and universal but only sees what crosses
the wire (it infers scope from headers). The SDK gives you explicit control (custom scope,
`chooseModel`, `recordToolUsage`, pre-flight `enforceBudget`) at the cost of a few lines per
call site. Most teams use the proxy for coverage and the SDK where they need fine control.

## 2. Webhooks & notifications

TBM emits events you can react to from anywhere. Register per-tenant delivery channels; TBM
signs payloads (HMAC-SHA256), delivers with exponential-backoff retries, and records every
attempt.

### Events
`soft_limit_crossed`, `warning_threshold`, `hard_limit_blocked`, `approval_required`,
`approval_resolved`, `loop_stopped`, `agent_paused`, `agent_resumed`.

### Channel kinds
- `generic` / `http` — POST a **signed JSON envelope** `{ id, type, createdAt, data }` with
  headers `X-TBM-Event` and `X-TBM-Signature: sha256=<hmac>`. Verify with the channel `secret`.
  Use for Teams/Discord/internal systems.
- `slack` — POST `{ text }` (human-readable) to a Slack incoming webhook URL.
- `email` — MVP is a documented **stub** (`sendEmail` logs the message). Swap for a nodemailer
  SMTP transport (`SMTP_URL`) to send real mail — the interface is already in
  `backend/src/services/events.ts`.

### Register a channel
```bash
# Generic signed webhook, all events
curl -X POST http://localhost:4000/v1/webhooks \
  -H "x-api-key: tbm_demo_local_key" -H "content-type: application/json" \
  -d '{"kind":"generic","url":"https://example.com/tbm","events":"all"}'

# Slack, only blocks + approvals
curl -X POST http://localhost:4000/v1/webhooks \
  -H "x-api-key: tbm_demo_local_key" -H "content-type: application/json" \
  -d '{"kind":"slack","url":"https://hooks.slack.com/services/XXX","events":["hard_limit_blocked","approval_required"]}'

# Fire a test event
curl -X POST http://localhost:4000/v1/webhooks/test -H "x-api-key: tbm_demo_local_key"
```
Other endpoints: `GET /v1/webhooks`, `DELETE /v1/webhooks/:id`,
`GET /v1/webhooks/:id/deliveries`, `GET /v1/events`.

### Verify a signature (receiver side, Node)
```ts
import crypto from 'node:crypto';
function verify(secret: string, rawBody: string, header: string) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
}
```

### Actionable approvals
`approval_required` payloads include one-click `approveUrl` / `denyUrl` (signed token, no API
key needed). They hit `GET /v1/approvals/:id/resolve?action=approve|deny&token=…`, flip the
`llm_request` to allowed/blocked, and emit `approval_resolved`. Set `TBM_PUBLIC_URL` so the
links point at your public host.

**Delivery reliability:** in-process retry with exponential backoff
(`TBM_WEBHOOK_BACKOFF_MS`, `TBM_WEBHOOK_MAX_ATTEMPTS`); every attempt is persisted in
`webhook_deliveries`. **Trade-off:** single-node in-memory scheduling is fine for the MVP; for
horizontal scale move delivery to a durable queue (e.g. BullMQ/Redis) — the `dispatchDelivery`
function is the single seam to swap.

<!-- Sections 3 (Docker), 4 (Framework middleware), and 5 (No-code) are added in their phases. -->
