"""Token Budget Manager — Python SDK.

Conceptually identical surface to the TypeScript SDK:
    before_llm_call, after_llm_call, estimate_tokens, enforce_budget,
    choose_model, compress_context_if_needed, record_tool_usage.

HTTP uses the stdlib (urllib) so the only optional dependency is `tiktoken`
for accurate token estimation. Without tiktoken a documented chars/4 heuristic
is used.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

try:  # accurate estimation when available
    import tiktoken  # type: ignore

    _HAS_TIKTOKEN = True
except Exception:  # pragma: no cover - fallback path
    _HAS_TIKTOKEN = False


def _encoding_for_model(model: str) -> str:
    if re.match(r"^(gpt-4o|gpt-4\.1|o1|o3|o4|gpt-5|chatgpt-4o)", model, re.IGNORECASE):
        return "o200k_base"
    return "cl100k_base"


class BudgetExceededError(Exception):
    """Raised by enforce_budget() when a policy blocks the call."""

    def __init__(self, check: "CheckResult"):
        self.decision = check.decision
        self.check = check
        super().__init__(f"Budget enforcement blocked the call ({check.decision}): {check.reason}")


@dataclass
class CheckResult:
    requestId: Optional[str]
    decision: str
    allowed: bool
    reason: str
    forecast: Dict[str, Any]
    signals: Dict[str, Any] = field(default_factory=dict)
    recommendedModel: Optional[str] = None
    budgets: List[Any] = field(default_factory=list)
    raw: Dict[str, Any] = field(default_factory=dict)


class TokenBudgetClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = "http://localhost:4000",
        scope: Optional[Dict[str, str]] = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.scope = scope or {}

    # ---- local estimation ----
    def estimate_tokens(self, messages, model: str = "gpt-4o-mini") -> int:
        if isinstance(messages, str):
            messages = [{"role": "user", "content": messages}]
        if _HAS_TIKTOKEN:
            try:
                enc = tiktoken.get_encoding(_encoding_for_model(model))
                total = 3
                for m in messages:
                    total += 3 + len(enc.encode(m.get("content", ""))) + len(enc.encode(m.get("role", "")))
                    if m.get("name"):
                        total += len(enc.encode(m["name"]))
                return total
            except Exception:
                pass
        chars = sum(len(m.get("content", "")) + 4 for m in messages)
        return (chars // 4) + 3

    # ---- HTTP ----
    @staticmethod
    def _prune(value):
        """Drop None values so the server sees absent (optional) fields, not null."""
        if isinstance(value, dict):
            return {k: TokenBudgetClient._prune(v) for k, v in value.items() if v is not None}
        if isinstance(value, list):
            return [TokenBudgetClient._prune(v) for v in value]
        return value

    def _request(self, path: str, body: Optional[dict] = None, method: str = "POST") -> dict:
        url = f"{self.base_url}{path}"
        pruned = self._prune(body) if body is not None else None
        data = None if method == "GET" else (json.dumps(pruned).encode() if pruned is not None else None)
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("content-type", "application/json")
        req.add_header("x-api-key", self.api_key)
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            payload = e.read().decode()
            if e.code == 402:  # blocked by policy — return the body
                return json.loads(payload or "{}")
            raise RuntimeError(f"TBM {path} failed {e.code}: {payload[:300]}") from e

    def _merge_scope(self, scope: Optional[dict]) -> dict:
        return {**self.scope, **(scope or {})}

    # ---- gateway ----
    def before_llm_call(
        self,
        model: str,
        messages: List[dict],
        provider: Optional[str] = None,
        expected_completion_tokens: Optional[int] = None,
        tool_calls: Optional[int] = None,
        scope: Optional[dict] = None,
    ) -> CheckResult:
        raw = self._request(
            "/v1/check-budget",
            {
                "model": model,
                "provider": provider,
                "messages": messages,
                "expectedCompletionTokens": expected_completion_tokens,
                "toolCalls": tool_calls,
                "scope": self._merge_scope(scope),
            },
        )
        return CheckResult(
            requestId=raw.get("requestId"),
            decision=raw.get("decision", "allow"),
            allowed=raw.get("allowed", True),
            reason=raw.get("reason", ""),
            forecast=raw.get("forecast", {}),
            signals=raw.get("signals", {}),
            recommendedModel=raw.get("recommendedModel"),
            budgets=raw.get("budgets", []),
            raw=raw,
        )

    def enforce_budget(self, check: CheckResult) -> CheckResult:
        if not check.allowed:
            raise BudgetExceededError(check)
        return check

    def after_llm_call(
        self,
        request_id: str,
        usage: dict,
        model: Optional[str] = None,
        status: str = "completed",
    ) -> dict:
        return self._request(
            "/v1/record-usage",
            {"requestId": request_id, "usage": usage, "model": model, "status": status},
        )

    def record_tool_usage(
        self, tool: str, tool_tokens: int, model: Optional[str] = None, scope: Optional[dict] = None
    ) -> dict:
        return self._request(
            "/v1/record-tool-usage",
            {"tool": tool, "toolTokens": tool_tokens, "model": model, "scope": self._merge_scope(scope)},
        )

    def choose_model(
        self,
        requested_model: str,
        prompt_tokens: int,
        prefer_cheaper: bool = True,
        expected_completion_tokens: Optional[int] = None,
        remaining_budget_usd: Optional[float] = None,
        remaining_budget_tokens: Optional[int] = None,
    ) -> dict:
        return self._request(
            "/v1/optimize/choose-model",
            {
                "requestedModel": requested_model,
                "promptTokens": prompt_tokens,
                "preferCheaper": prefer_cheaper,
                "expectedCompletionTokens": expected_completion_tokens,
                "remainingBudgetUsd": remaining_budget_usd,
                "remainingBudgetTokens": remaining_budget_tokens,
            },
        )

    def forecast_run(
        self,
        model: str,
        estimated_steps: int,
        avg_prompt_tokens: int,
        avg_completion_tokens: int,
        tool_calls_per_step: Optional[int] = None,
        avg_tool_tokens: Optional[int] = None,
        scope: Optional[dict] = None,
    ) -> dict:
        return self._request(
            "/v1/forecast/run",
            {
                "model": model,
                "estimatedSteps": estimated_steps,
                "avgPromptTokens": avg_prompt_tokens,
                "avgCompletionTokens": avg_completion_tokens,
                "toolCallsPerStep": tool_calls_per_step,
                "avgToolTokens": avg_tool_tokens,
                "scope": self._merge_scope(scope),
            },
        )

    def get_savings_ledger(self) -> dict:
        return self._request("/v1/analytics/savings-ledger", method="GET")

    def get_chargeback(
        self,
        group_by: str = "agent",
        from_ts: Optional[str] = None,
        to_ts: Optional[str] = None,
    ) -> list:
        qs = f"groupBy={group_by}"
        if from_ts:
            qs += f"&from={from_ts}"
        if to_ts:
            qs += f"&to={to_ts}"
        return self._request(f"/v1/analytics/chargeback?{qs}", method="GET")  # type: ignore[return-value]

    def export_policy_pack(self) -> dict:
        return self._request("/v1/policy-packs/export", method="GET")

    def import_policy_pack(
        self,
        pack_id: Optional[str] = None,
        pack: Optional[dict] = None,
        scope_bindings: Optional[dict] = None,
    ) -> dict:
        return self._request(
            "/v1/policy-packs/import",
            {"packId": pack_id, "pack": pack, "scopeBindings": scope_bindings},
        )

    def compress_context_if_needed(self, model: str, messages: List[dict], target_tokens: int) -> dict:
        return self._request(
            "/v1/optimize/compress",
            {"model": model, "messages": messages, "targetTokens": target_tokens},
        )

    def complete(
        self,
        model: str,
        messages: List[dict],
        provider: str = "mock",
        max_tokens: Optional[int] = None,
        auto_compress: bool = False,
        scope: Optional[dict] = None,
    ) -> dict:
        return self._request(
            "/v1/llm/complete",
            {
                "model": model,
                "messages": messages,
                "provider": provider,
                "maxTokens": max_tokens,
                "autoCompress": auto_compress,
                "scope": self._merge_scope(scope),
            },
        )


__all__ = ["TokenBudgetClient", "CheckResult", "BudgetExceededError"]
