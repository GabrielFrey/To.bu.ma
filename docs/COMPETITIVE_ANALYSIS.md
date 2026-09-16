# Token Budget Manager — Competitive Analysis

> Last updated: July 2026. Grounded in public docs, pricing pages, and OSS READMEs.
> URLs cited inline; capabilities change — verify before purchase decisions.

## 1. Executive summary

The LLM tooling landscape splits into **five buckets** that rarely overlap:

| Bucket | Examples | Primary job |
|---|---|---|
| **Observability / eval** | Langfuse, Helicone, Braintrust, LangSmith, Phoenix, HoneyHive, Galileo, Maxim | Trace, score, debug *after* calls |
| **Gateway / router** | LiteLLM, Portkey, Cloudflare AI Gateway, OpenRouter, TrueFoundry | Route, cache, rate-limit, sometimes budget |
| **FinOps / billing** | Stripe token billing, Orb, Metronome, OpenMeter, Amberflo | Meter usage → invoice customers |
| **Guardrails / safety** | Guardrails AI, NeMo, Lakera, Galileo Protect | Block toxic/unsafe *content*, not spend |
| **Agent budget SDKs** | costfuse, AgentBudget, Runcap | Per-session USD caps at SDK layer |

**Token Budget Manager (TBM)** targets the intersection none of them fully own: **agent-native, hierarchical, reservation-based hard budget enforcement** with **loop control**, **run-level forecasting**, **policy simulation**, and a **savings ledger** — all on a drop-in OpenAI-compatible proxy.

**Honest verdict:** TBM is **not** the only product with pre-flight budget blocking (LiteLLM, Portkey, TrueFoundry, costfuse, AgentBudget all block). TBM's defensible uniqueness is the **combination** of eight-level scope hierarchy, agent loop economics, run-level forecast, counterfactual savings ROI, and policy dry-run — in one self-hostable OSS stack.

---

## 2. Competitor profiles

### 2.1 Gateways & proxies

#### LiteLLM
- **What:** OSS Python proxy + SDK; 100+ providers; virtual keys; spend tracking.
- **Pricing/OSS:** [MIT OSS](https://github.com/BerriAI/litellm); [hosted proxy](https://docs.litellm.ai/docs/proxy/deploy) optional.
- **Strengths:** Mature multi-tenant hierarchy (Org → Team → User → Key); hard budget rejection; Redis-backed counters; `fail_closed_budget_enforcement` for DB-authoritative checks ([budget docs](https://docs.litellm.ai/docs/proxy/users)).
- **Falls short on agent-aware budgets:** No session/task/agent-run scope; no loop detection; no run-level "will this 20-step agent bust budget?"; no policy simulation; no savings counterfactual; enforcement is key/team-centric, not agentic-workflow-centric.

#### Portkey
- **What:** AI gateway with observability, routing, guardrails, enterprise budget policies.
- **Pricing/OSS:** Closed source; budget limits on [Enterprise / select Pro](https://docs.portkey.ai/docs/product/administration/enforce-budget-and-rate-limit).
- **Strengths:** Workspace + virtual-key budgets; hard block (HTTP 412); metadata-conditioned policies; coding-agent positioning ([coding agents doc](https://portkey.ai/docs/product/coding-agent)).
- **Falls short:** Budget dimensions are org/workspace/key/metadata — not org→agent→session→task; no agent loop stop; no run forecast; no savings ledger; no policy dry-run; enterprise-gated.

#### Cloudflare AI Gateway
- **What:** Edge proxy with caching, rate limits, logging, unified billing.
- **Pricing/OSS:** [Cloudflare product](https://developers.cloudflare.com/ai-gateway/); pay-per-request platform pricing.
- **Strengths:** Global edge, caching, provider failover, cost *visibility*.
- **Falls short:** Rate limits and logging, not hierarchical agent budgets; no loop detection; no pre-flight reservation model documented.

#### Helicone
- **What:** OSS LLM gateway + observability; one-line proxy integration.
- **Pricing/OSS:** [MIT OSS](https://github.com/Helicone/helicone); cloud from ~$79/mo.
- **Strengths:** Cost-based rate limiting via headers; 300+ model pricing; session attribution ([cost rate limits](https://docs.helicone.ai/features/advanced-usage/cost-rate-limiting)).
- **Falls short:** Rate limits ≠ hierarchical hard budgets; post-hoc cost dashboards; no agent loop stop; no run-level forecast; no policy simulation.

#### OpenRouter
- **What:** Multi-model router with per-key credits and guardrails.
- **Pricing/OSS:** Closed; credits-based ([guardrails](https://openrouter.ai/docs/guides/features/guardrails)).
- **Strengths:** Provider routing, model restrictions, key-level spend caps.
- **Falls short:** Key/credit model, not agent hierarchy; no loop detection; no savings ROI.

#### TrueFoundry AI Gateway
- **What:** Enterprise gateway with budget limiting, routing, chargeback.
- **Pricing/OSS:** Closed source; [budget limiting docs](https://www.truefoundry.com/docs/ai-gateway/budgetlimiting).
- **Strengths:** YAML budget rules; hard block (HTTP 429); atomic Redis counters; team/user/model/metadata dimensions; chargeback exports ([cost attribution blog](https://www.truefoundry.com/blog/llm-cost-attribution-team-budgets)).
- **Falls short:** Closest enterprise competitor on hard budgets — but no session/task/agent-run hierarchy; no signature-based loop stop; no run-level forecast; no policy dry-run against history; no counterfactual savings ledger.

#### Kong AI Gateway
- **What:** API-management gateway with AI plugins.
- **Pricing/OSS:** OSS core + enterprise; AI plugins commercial.
- **Strengths:** Enterprise API governance, plugin ecosystem.
- **Falls short:** General API gateway — LLM agent budgets not first-class.

#### Martian / Not Diamond
- **What:** Model routers optimizing quality/cost/latency.
- **Pricing/OSS:** Closed SaaS.
- **Strengths:** Intelligent model selection.
- **Falls short:** Routing intelligence, not budget enforcement or agent governance.

---

### 2.2 Observability & evaluation

#### Langfuse
- **What:** OSS tracing, prompts, evals, scores.
- **Pricing/OSS:** [MIT self-host](https://langfuse.com/pricing); cloud from $29/mo.
- **Strengths:** Deep traces, prompt lifecycle, OTel-native, CI eval gates.
- **Falls short:** Observability-first — alerts, not pre-flight hard blocks ([industry consensus](https://jatinbansal.com/ai-engineering/agent-budgets-and-runaway-prevention/)); no hierarchical budget enforcement; no loop stop in request path.

#### LangSmith (LangChain)
- **What:** LangChain-native tracing, evals, monitoring.
- **Pricing/OSS:** Closed; tiered SaaS.
- **Strengths:** LangChain/LangGraph integration, dataset evals.
- **Falls short:** `recursion_limit` / `max_turns` are step caps, not dollar budgets; no org→agent hierarchy; post-hoc cost views.

#### Arize Phoenix
- **What:** OSS LLM eval + observability.
- **Pricing/OSS:** OSS + cloud.
- **Strengths:** Open-source eval loops, drift detection.
- **Falls short:** Quality/observability, not spend enforcement.

#### Weights & Biases Weave
- **What:** Experiment tracking extended to LLM traces.
- **Pricing/OSS:** Freemium SaaS.
- **Strengths:** W&B ecosystem, trace scoring.
- **Falls short:** No hard budget gate.

#### Traceloop / OpenLLMetry
- **What:** OTel instrumentation for LLM apps.
- **Pricing/OSS:** OSS SDK + commercial platform.
- **Strengths:** Standard telemetry export.
- **Falls short:** Instrumentation layer, not enforcement.

#### Lunary
- **What:** LLM monitoring + prompt management.
- **Pricing/OSS:** OSS option + cloud.
- **Strengths:** Lightweight monitoring.
- **Falls short:** No hierarchical hard budgets.

#### Braintrust
- **What:** Eval + observability + CI quality gates.
- **Pricing/OSS:** [Free tier 1M spans](https://www.braintrust.dev/pricing); Pro $249/mo flat.
- **Strengths:** Trace-level cost attribution, eval-driven cost reduction workflows ([cost article](https://www.braintrust.dev/articles/how-to-reduce-costs-for-llms-using-braintrust)).
- **Falls short:** Cost visibility + quality gates, not runtime hard dollar caps; no agent loop economics.

#### PromptLayer
- **What:** Prompt registry/CMS + request logging.
- **Pricing/OSS:** [Free 2.5k requests](https://promptlayer.com/pricing); Pro $49/mo.
- **Strengths:** Non-engineer prompt editing, request metadata.
- **Falls short:** Prompt management; lighter tracing; no enforcement.

#### Humanloop
- **What:** Prompt engineering + eval platform (acquired by Anthropic, winding down SaaS).
- **Pricing/OSS:** Was commercial SaaS.
- **Strengths:** Prompt versioning, human review.
- **Falls short:** Not a budget enforcement product.

#### Maxim AI
- **What:** Agent simulation + eval + observability.
- **Pricing/OSS:** [Developer free tier](https://www.getmaxim.ai/pricing); Pro $29/seat.
- **Strengths:** Pre-production agent simulation, multi-eval methods.
- **Falls short:** Simulation/eval focus; no hierarchical runtime budget enforcement.

#### HoneyHive
- **What:** OTel-native agent observability; trajectory views.
- **Pricing/OSS:** Commercial SaaS.
- **Strengths:** Agent trajectory visualization, online evals, cost/latency alerts.
- **Falls short:** Observability + alerts; no documented pre-flight hard budget block.

#### Galileo
- **What:** Agent reliability — eval, observability, Luna guardrails.
- **Pricing/OSS:** [Free developer tier announced Jul 2025](https://www.prnewswire.com/news-releases/galileo-announces-free-agent-reliability-platform-302508172.html).
- **Strengths:** Loop/failure detection, real-time guardrails on *quality* metrics, session-level traces ([monitoring blog](https://galileo.ai/blog/effective-llm-monitoring)).
- **Falls short:** Guardrails target safety/quality (toxicity, PII), not hierarchical *dollar/token* budgets; no savings ledger; no policy simulation.

---

### 2.3 FinOps, metering & billing

#### OpenMeter
- **What:** Usage metering for AI/SaaS; event ingestion → billing.
- **Pricing/OSS:** OSS + cloud ([openmeter.io](https://openmeter.io)).
- **Strengths:** Real-time metering, credit burndown, Stripe integration.
- **Falls short:** Meters usage for *billing customers* — does not block agent calls pre-flight.

#### Stripe Billing for LLM Tokens
- **What:** Token metering → customer invoices via Stripe AI Gateway / Meter API.
- **Pricing/OSS:** [Private preview](https://docs.stripe.com/billing/token-billing); Stripe fees apply.
- **Strengths:** Provider price sync, margin markup, rejects when customer credit exhausted (when enabled).
- **Falls short:** B2B billing rail, not internal agent governance; no agent loop detection.

#### Orb
- **What:** Enterprise usage-based billing with SQL-defined metrics.
- **Pricing/OSS:** Closed; custom pricing ([comparison](https://www.aibilling.dev/compare/orb-vs-stripe-billing)).
- **Strengths:** Pricing simulation against historical usage, finance integrations.
- **Falls short:** Invoice-time metering, not request-path enforcement.

#### Metronome (Stripe)
- **What:** High-throughput usage billing acquired by Stripe.
- **Pricing/OSS:** Stripe add-on ([Metronome](https://stripe.com/billing/usage-based-billing)).
- **Strengths:** Multidimensional pricing, credit burndown, enterprise contracts.
- **Falls short:** Revenue recognition, not agent kill-switch.

#### Amberflo / Truefoundry chargeback
- **What:** Usage-based billing / internal chargeback.
- **Falls short:** Financial attribution after the fact unless paired with a gateway.

#### FinOps Foundation AI guidance
- **What:** Frameworks for cloud AI cost allocation ([FinOps Foundation](https://www.finops.org/)).
- **Falls short:** Methodology, not a product.

---

### 2.4 Cloud provider native

#### AWS Bedrock
- **What:** Managed models + Guardrails + invocation logging.
- **Pricing/OSS:** Pay-per-token; [cost management guide](https://docs.aws.amazon.com/bedrock/latest/userguide/cost-management.html).
- **Strengths:** AIP cost allocation tags, invocation logs, Guardrails for content safety.
- **Falls short:** **No native IAM/token budget enforcement** — requires custom Lambda gatekeeper ([re:Post guide](https://repost.aws/articles/ARoDnASCxDQyGFfaagReMZNw/how-to-track-and-limit-amazon-bedrock-usage-by-user)); AWS Budgets are daily alerts, not millisecond blocks.

#### Azure AI Content Safety / cost management
- **What:** Content filtering + Azure Cost Management tags.
- **Falls short:** Safety filters and cloud cost alerts, not agent hierarchical budgets.

#### Google Vertex AI governance
- **What:** Model Garden, VPC-SC, audit logs, quota limits (RPM/TPM).
- **Falls short:** Service quotas ≠ dollar budgets; no agent loop control.

---

### 2.5 Agent frameworks (native budget features)

| Framework | Native control | Gap |
|---|---|---|
| **LangChain/LangGraph** | `recursion_limit`, callbacks | Step count, not dollars; no cross-agent fleet budgets |
| **LlamaIndex** | Workflow timeouts | No hierarchical spend caps |
| **CrewAI** | Task limits (manual) | No centralized budget service |
| **AutoGen** | `max_turns` | Turn cap, not cost |
| **OpenAI Agents SDK** | `max_turns`, tracing | No org-level enforcement |
| **Vercel AI SDK** | `maxSteps`, provider middleware | App-level; no multi-tenant budget service |

Framework limits are **local and coarse**. TBM is the external control plane.

---

### 2.6 Guardrails (context, not direct competitors)

| Product | Focus | Budget overlap |
|---|---|---|
| **Guardrails AI** | Schema/validator guardrails | None |
| **NeMo Guardrails** | Dialog policy rails | None |
| **Lakera Guard** | Prompt injection / security | None |

These complement TBM (safety) rather than replace it (spend).

---

### 2.7 Direct budget-enforcement peers (important)

#### costfuse ([GitHub](https://github.com/costfuse/costfuse))
- **Strengths:** OSS Apache-2.0; pre-call block; loop detection via prompt fingerprint; hourly/daily USD caps; Python + Node SDK wrappers.
- **Falls short vs TBM:** Flat rules, not org→project→agent→session→task hierarchy; no reservation concurrency model; no run forecast; no policy simulation; no savings ledger; no dashboard/proxy.

#### AgentBudget ([GitHub](https://github.com/AgentBudget/agentbudget))
- **Strengths:** Per-session USD hard/soft limits; loop detection; patches OpenAI/Anthropic SDKs; Python/TS/Go.
- **Falls short vs TBM:** Session-scoped only; no multi-tenant hierarchy; no policy engine; no proxy; no chargeback.

#### Runcap ([runcycles.io](https://runcycles.io/blog/ai-agent-cost-control-2026-litellm-helicone-openrouter-runtime-authority))
- **Strengths:** Pre-run cost estimate; hard mid-run stop; token compression.
- **Falls short vs TBM:** Single-run focus; no enterprise hierarchy; closed/commercial.

#### Cursor IDE ([spend limits docs](https://cursor.com/help/account-and-billing/spend-limits.md))
- **Strengths:** Monthly hard spend limits for Cursor's own agent/composer usage; team/member overrides; soft alerts at 50/80/100%.
- **Falls short:** **Product-specific billing control**, not a general-purpose layer for your agents/APIs; no custom hierarchy beyond team/member.

---

### 2.8 Observability platforms with AI cost modules

#### Datadog LLM Observability
- **What:** Trace-level cost estimation, CCM integration, budget *monitors* ([cost docs](https://docs.datadoghq.com/llm_observability/monitoring/cost/)).
- **Strengths:** Full-stack correlation (GPU + LLM + infra); forecast monitors ([CCM monitors](https://docs.datadoghq.com/cloud_cost_management/cost_changes/monitors)).
- **Falls short:** **Alerts, not request-path blocks**; no agent loop stop; no policy actions (degrade/compress/stop-agent).

#### New Relic AI monitoring
- **What:** AI observability add-on to NR platform.
- **Strengths:** Enterprise APM integration.
- **Falls short:** Observability; enforcement requires external gateway.

---

## 3. Feature comparison matrix

Legend: ✅ native & documented · ⚠️ partial/indirect · ❌ not available · 🔶 TBM

| Capability | LiteLLM | Portkey | Helicone | Langfuse | TrueFoundry | costfuse | AgentBudget | Datadog | Stripe/Orb | **TBM** |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Pre-flight hard budget block** | ✅ | ✅ | ⚠️ rate | ❌ | ✅ | ✅ | ✅ | ❌ alert | ⚠️ credit | 🔶 ✅ |
| **Hierarchical budgets (org→request)** | ⚠️ 4-level | ⚠️ ws/key | ❌ | ❌ | ⚠️ rules | ❌ | ❌ | ❌ | ❌ | 🔶 ✅ 8-level |
| **Reservation / concurrency-safe** | ⚠️ Redis | ⚠️ | ❌ | ❌ | ✅ Redis | ❌ | ❌ | ❌ | ❌ | 🔶 ✅ DB |
| **Agent loop detection / stop** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ⚠️ detect | ❌ | 🔶 ✅ |
| **Run-level cost forecast** | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ pre-run | ⚠️ session | ❌ | ❌ | 🔶 ✅ |
| **Policy simulation / dry-run** | ❌ | ❌ | ❌ | ❌ | ⚠️ audit | ❌ | ❌ | ❌ | ✅ Orb | 🔶 ✅ |
| **Savings ledger / counterfactual ROI** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🔶 ✅ |
| **Policy actions (degrade/compress/stop)** | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ❌ | ⚠️ | ❌ | ❌ | 🔶 ✅ |
| **OpenAI drop-in proxy** | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ SDK | ❌ SDK | ❌ | ⚠️ | 🔶 ✅ |
| **Self-host / OSS** | ✅ MIT | ❌ | ✅ MIT | ✅ MIT | ❌ | ✅ | ✅ | ❌ | ❌ | 🔶 ✅ local |
| **Quality eval / tracing depth** | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ | ✅ | ❌ | ⚠️ basic |
| **Multi-provider routing** | ✅ | ✅ | ✅ | ❌ | ✅ | ⚠️ | ⚠️ | ❌ | ⚠️ | ⚠️ degrade |
| **Customer billing / invoicing** | ⚠️ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ✅ | ❌ |

---

## 4. Gap analysis — what the market does poorly

### G1. Observability ≠ enforcement
Most tools (Langfuse, Braintrust, HoneyHive, Datadog, Phoenix) excel at **forensics** but cannot **reach back** to block the call that crossed the threshold. Alerts fire after tokens are spent.

### G2. Budget scope is too flat
LiteLLM/Portkey/TrueFoundry budget at org/team/key/workspace. **Agent workflows** need session, task, and tool-call granularity — a 50-step ReAct loop should inherit session+task caps simultaneously.

### G3. No run-level economics
Per-request checks miss the question: *"This agent plan will take ~15 LLM calls — will the **task** budget survive?"* Only Runcap/costfuse partially address this; none combine it with hierarchical budgets.

### G4. No counterfactual savings proof
Enterprises cannot answer: *"How many dollars did our compress policy actually save vs baseline?"* Finance needs ROI, not just blocked-request counts.

### G5. Policy changes are blind deployments
TrueFoundry's `audit_mode` and Orb's pricing simulation exist in isolation. No gateway lets you **replay last week's traffic** against a new policy set and see projected blocks/savings before enabling.

### G6. Agent loop spend is undertreated
Framework `max_turns` stops on step count, not **identical-prompt loops** burning money. costfuse/AgentBudget detect loops at SDK layer but lack fleet-wide policy + dashboard.

### G7. FinOps tools meter, gateways block — rarely both
Stripe/Orb/Metronome bill customers; gateways block internal spend. TBM bridges internal enforcement; billing integration is a future adjacency, not core.

---

## 5. Where competitors still win (honest)

| Competitor | They lead on | TBM should not overclaim |
|---|---|---|
| **Langfuse / Braintrust / Galileo** | Eval quality, trace depth, CI gates, guardrail SLMs | TBM analytics are spend-focused, not full eval suites |
| **LiteLLM / Portkey / TrueFoundry** | Multi-provider routing breadth, production scale, Redis atomicity at 10k RPS | TBM MVP uses SQLite reservations; Redis noted for scale |
| **Helicone** | Edge caching, 300+ model price tables | TBM pricing seed is smaller; caching not built-in |
| **Datadog / New Relic** | Infra+LLM unified observability, enterprise APM | TBM is not an APM replacement |
| **Stripe / Orb / Metronome** | Customer invoicing, ASC 606, payment rails | TBM is not a billing system |
| **Cursor** | IDE-native UX for their own agent product | TBM is infrastructure, not an IDE |
| **costfuse / AgentBudget** | Zero-infra SDK drop-in for single-process agents | TBM adds server + proxy for fleet governance |

---

## 6. Differentiation strategy (ranked impact × feasibility)

See [`DIFFERENTIATION.md`](./DIFFERENTIATION.md) for implementation specs. Summary ranking:

1. **Hierarchical reservation-based hard enforcement** — table stakes, but 8-level scope + most-restrictive-wins is rare.
2. **Agent loop economics + stop** — shared with costfuse/AgentBudget; TBM adds policy engine + dashboard.
3. **Run-level predictive overflow** — high impact, moderate feasibility; **implemented in TBM**.
4. **Savings ledger (counterfactual ROI)** — high impact for finance; **implemented in TBM**.
5. **Policy simulation / dry-run** — high impact for safe rollouts; **implemented in TBM**.
6. **Cross-provider price-aware routing under budget** — **implemented** via `chooseModel` remaining-budget fit; quality-aware routing deferred.
7. **Portable policy packs / marketplace** — **implemented** (import/export JSON + support-desk / batch-etl templates).
8. **Multi-tenant chargeback exports** — **implemented** (CSV/JSON by agent/task/project/user).

---

## 7. Is "no direct analog" defensible?

**Partially.** A **single** product combining all of:
- 8-level hierarchical hard budgets with reservations
- Agent loop stop in the request path
- Run-level forecast before multi-step runs
- Counterfactual savings ledger
- Policy dry-run against historical traffic
- OpenAI-compatible proxy + OSS self-host

…is **not available as one integrated OSS stack** as of mid-2026. Individual pieces exist (LiteLLM budgets, costfuse loops, TrueFoundry chargeback, Orb simulation, Runcap pre-run estimate). **TBM's moat is integration depth for agentic spend governance**, not any single feature in isolation.

**Not defensible to claim:** "Only product with hard budget blocks" or "Only product with loop detection" — costfuse, AgentBudget, LiteLLM, Portkey, and TrueFoundry disprove that.

---

## 8. References

- LiteLLM budgets: https://docs.litellm.ai/docs/proxy/users
- Portkey budget limits: https://docs.portkey.ai/docs/product/administration/enforce-budget-and-rate-limit
- Helicone cost rate limits: https://docs.helicone.ai/features/advanced-usage/cost-rate-limiting
- Langfuse pricing: https://langfuse.com/pricing
- TrueFoundry budget limiting: https://www.truefoundry.com/docs/ai-gateway/budgetlimiting
- costfuse: https://github.com/costfuse/costfuse
- AgentBudget: https://github.com/AgentBudget/agentbudget
- Stripe token billing: https://docs.stripe.com/billing/token-billing
- Datadog LLM cost: https://docs.datadoghq.com/llm_observability/monitoring/cost/
- AWS Bedrock cost limits: https://repost.aws/articles/ARoDnASCxDQyGFfaagReMZNw/how-to-track-and-limit-amazon-bedrock-usage-by-user
- Cursor spend limits: https://cursor.com/help/account-and-billing/spend-limits.md
- Galileo agent reliability: https://www.prnewswire.com/news-releases/galileo-announces-free-agent-reliability-platform-302508172.html
- Braintrust cost reduction: https://www.braintrust.dev/articles/how-to-reduce-costs-for-llms-using-braintrust
