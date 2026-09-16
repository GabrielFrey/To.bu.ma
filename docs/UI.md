# Dashboard UI

Operator console for Token Budget Manager: how much is being spent, who is
burning it, whether a hard limit is close, what was blocked, and what to do
next.

## Information architecture

Left navigation, hash views (`#overview`, `#spend`, …), sticky header.

| View | Answers | Source |
| --- | --- | --- |
| **Overview** | Tokens, USD, requests, blocked count, tightest budget; top agents; alerts; recommendations; assistant spend chip | `/v1/analytics/*`, `/v1/assistant/spend` |
| **Spend** | By agent / task / project; expensive prompts; loops; savings ledger; chargeback CSV | analytics + chargeback |
| **Budgets** | Cards with soft vs hard utilization, remaining, reset period; policy pack import | `/v1/analytics/active-budgets`, `/v1/budgets`, `/v1/policy-packs` |
| **Policies** | Active policies; simulate against the selected period | `/v1/policies`, `POST /v1/policies/simulate` |
| **Requests** | Blocked, warnings, recent LLM requests | `/v1/analytics/blocked`, `warnings`, `recent-requests` |
| **Assistant** | Chat, tool-call cards, confirmation gate, Web Speech | `AssistantPanel`, `VoiceControls`, `useVoice` |
| **Settings** | Base URL and API key | `localStorage` |

Header: period picker (today / 7 days / 30 days), tenant + environment label,
search (`⌘K` / `Ctrl+K`), **Assistant** (opens the right-rail drawer with mic
and chat unless you are already on the Assistant page).

Skip link: “Skip to main content”. Keyboard: tab through nav, hash links,
command palette arrows + Enter.

## Time period

The picker sends `from` / `to` ISO query params to spend, warnings, blocked,
expensive prompts, loops, recommendations, and recent requests. Budgets are
current window (reset period), not the picker. The savings ledger is still
all-time — that is called out in the UI copy.

## Assistant and voice

Stable names for later merges:

- `AssistantPage` — full-page chat (`#assistant`)
- `AssistantDrawer` — right-rail sheet from the header
- `AssistantPanel` — conversation, suggestions, spend dogfooding
- `VoiceControls` + `useVoice` — hold-to-talk, hands-free, speak replies,
  `Ctrl+Shift+M`

Only one of page or drawer is mounted at a time so a streaming turn is not
duplicated. Polling pauses while the assistant is open.

## States

Every data surface has three states:

- **Loading** — skeleton blocks (`animate-pulse`, disabled under
  `prefers-reduced-motion`), not a spinner
- **Empty** — one sentence and a CTA (open another view, ask the assistant, run
  the demo)
- **Error** — banner with Retry; first-load failure if `/v1/analytics/total`
  cannot be reached

## Design tokens

CSS variables in `dashboard/src/index.css`, mapped in `tailwind.config.js`.
Components use roles, not `slate-*`:

`surface`, `text` / `text-muted` (`text-muted` utility), `border`, `accent`,
`success`, `warning`, `danger`, plus status roles `info` and `gate`.

Type: sentence case. Page titles `text-xl font-semibold tracking-tight`. Body
`text-sm`. Captions `text-xs text-muted`.

## How to run

```bash
# backend on :4000, then:
cd dashboard && npm install && npm run dev
# http://localhost:5173  (proxies /v1 → :4000)
```

Demo key: `tbm_demo_local_key`. Seed + traffic: `npm run demo` from the repo
root (or `backend/`).
