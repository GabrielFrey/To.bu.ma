# Embed TBM in any business process

One page. Pick the seam your process already has, point it at TBM, drop a policy pack, subscribe finance.

## 1. Choose the seam (one is enough)

| Your process already talks to… | Do this |
|---|---|
| **OpenAI / Azure OpenAI SDK** (SAP BTP, custom CRM plugin, helpdesk bot) | Point `base_url` at `https://<tbm>/v1` and use a TBM API key. Attribution headers: `X-TBM-Project`, `X-TBM-Agent`, `X-TBM-Task`, `X-TBM-User`. |
| **LangChain / LangGraph / Vercel AI SDK** | Use `@tbm/integrations` (`tbmChatOpenAI` / `tbmOpenAIProvider`) or Python `tbm_chat_openai`. Same proxy, same enforcement. |
| **n8n / Zapier / Make / SAP CPI / Power Automate** | HTTP Request node → `POST /v1/chat/completions` **or** register the platform catch-hook as `POST /v1/webhooks`. Import `connectors/n8n/*.json`. |
| **In-house agent runtime** | TypeScript/Python SDK: `forecastRun` before a multi-step job, `beforeLLMCall` / `enforceBudget` per call, `afterLLMCall` after. |
| **Batch ETL / overnight jobs** | Import `packs/batch-etl-pack.json`, then either proxy the LLM client or wrap the worker with the SDK. |

Enforcement is the same path either way: check → policy (allow / degrade / compress / block) → optional upstream → record.

## 2. Drop a policy pack

Portable JSON (`kind: tbm-policy-pack`). Two starter packs ship in `packs/`:

- **support-desk-pack** — daily agent USD cap, per-ticket token cap, loop stop, retry cap, compress long threads.
- **batch-etl-pack** — project daily USD, hourly agent tokens, tool-call spiral stop, approval on expensive single calls.

```bash
# List templates, then import onto this tenant (binds optional scope ids).
curl -s http://localhost:4000/v1/policy-packs -H "x-api-key: $TBM_KEY"
curl -s -X POST http://localhost:4000/v1/policy-packs/import \
  -H "x-api-key: $TBM_KEY" -H "content-type: application/json" \
  -d '{"packId":"support-desk-pack","scopeBindings":{"agentId":"<agent>","taskId":"<task>"}}'

# Export live budgets+policies to share with another project/env.
curl -s http://localhost:4000/v1/policy-packs/export -H "x-api-key: $TBM_KEY" > my-pack.json
```

Dry-run first: `POST /v1/policies/simulate` with the pack's policies against last week's traffic.

## 3. Close the loop with ops and finance

- **Every blocked or degraded call** can fan out as `call_blocked` / `call_degraded` (plus the specific `hard_limit_blocked`, `loop_stopped`, `soft_limit_crossed` events). Register `POST /v1/webhooks` with `events: ["call_blocked","call_degraded"]` (or `"all"`) to a ticket queue, Slack, or SAP event mesh.
- **Chargeback / showback:** `GET /v1/analytics/chargeback.csv?groupBy=agent|task|project|user` — cost and tokens by dimension for GL / showback. Optional `from` / `to` ISO timestamps.
- **Will this job fit?** `POST /v1/forecast/run` before a 20-step agent or ETL slice.
- **What did policy save?** `GET /v1/analytics/savings-ledger`.

That is the whole embed: **one seam + one pack + one webhook + one CSV**.
