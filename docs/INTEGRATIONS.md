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

## 3. Deploy as a service (Docker)

```bash
cp .env.example .env
docker compose up --build
```
Brings up **backend + Postgres + dashboard**. Dashboard on `:8080`, API/proxy on `:4000`.
Health: `GET /health` (liveness), `GET /ready` (readiness — checks DB). First boot applies the
Postgres schema and seeds demo data only if empty; find the key with
`docker compose logs backend | grep "Demo API key"`.

**Postgres vs SQLite trade-off:** local `npm run demo`/tests use SQLite for zero-setup; Docker
uses Postgres for real concurrency/durability. One canonical `schema.prisma` drives both — the
Postgres variant is generated (`npm run prisma:generate:pg`) by swapping only the datasource
provider, so there is no schema drift. Enums are validated string columns to stay portable.

## 4. Framework middleware

These adapters are deliberately **thin: they route through the Phase 1 proxy** instead of
duplicating budget logic. One enforcement path, every framework covered.

**Trade-off — proxy routing vs native callbacks:** routing via `base_url` gives full
enforcement (block/degrade/compress) for free and is a one-liner. Native callbacks (e.g. a
LangChain handler) can only *observe/record* after the fact — they can't block a call
pre-flight. We therefore make proxy routing the default and offer a native callback only for
cases where you cannot change `base_url`.

### TypeScript — `@tbm/integrations` (`sdk/integrations/typescript`)
```ts
// Vercel AI SDK  (npm i ai @ai-sdk/openai)
import { generateText } from 'ai';
import { tbmOpenAIProvider } from '@tbm/integrations';
const openai = await tbmOpenAIProvider({ apiKey: 'tbm_...', scope: { agent: 'bot' } });
const { text } = await generateText({ model: openai('gpt-4o-mini'), prompt: 'Write a haiku.' });

// LangChain.js  (npm i @langchain/openai @langchain/core)
import { tbmChatOpenAI } from '@tbm/integrations';
const model = await tbmChatOpenAI({ apiKey: 'tbm_...', scope: { agent: 'bot' } }, { model: 'gpt-4o-mini' });
await model.invoke('Write a haiku about budgets.');
```
The framework packages are **optional peer deps** (imported dynamically), so `@tbm/integrations`
installs and typechecks without them. See `sdk/integrations/typescript/example.ts`.

### Python — LangChain (`sdk/python/tbm_sdk/integrations`)
```python
# pip install langchain-openai
from tbm_sdk.integrations import tbm_chat_openai
model = tbm_chat_openai(model="gpt-4o-mini", api_key="tbm_...", scope={"agent": "bot"})
print(model.invoke("Write a haiku about budgets.").content)

# Native callback (record-only) when you can't change base_url:
from tbm_sdk import TokenBudgetClient
from tbm_sdk.integrations import make_tbm_callback_handler
handler = make_tbm_callback_handler(TokenBudgetClient(api_key="tbm_..."), scope={"agent": "bot"})
# pass handler in callbacks=[handler] to your LangChain LLM/chain
```

<!-- Section 5 (No-code) is added in its phase. -->
