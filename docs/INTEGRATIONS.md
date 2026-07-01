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

<!-- Sections 2 (Webhooks/events), 3 (Docker), 4 (Framework middleware), and 5 (No-code)
     are added in their respective build phases. -->
