"""Thin LangChain (Python) integration for TBM.

Primary path: route LangChain's ChatOpenAI through the **TBM proxy** by pointing
`base_url` at TBM and using a TBM key. This reuses the single enforcement path
(budgets/policies/optimization) with zero duplicated logic.

Secondary path: a native callback handler that records token usage via the TBM
SDK when you call OpenAI directly. Prefer the proxy unless you cannot change
`base_url`.

Framework packages are imported lazily so importing this module never requires
LangChain to be installed.
"""
from __future__ import annotations

from typing import Any, Dict, Optional


def tbm_headers(scope: Optional[dict] = None, upstream: Optional[str] = None) -> Dict[str, str]:
    scope = scope or {}
    headers: Dict[str, str] = {}
    mapping = {
        "project": "X-TBM-Project",
        "agent": "X-TBM-Agent",
        "session": "X-TBM-Session",
        "task": "X-TBM-Task",
        "user": "X-TBM-User",
    }
    for key, header in mapping.items():
        if scope.get(key):
            headers[header] = str(scope[key])
    if upstream:
        headers["X-TBM-Upstream"] = upstream
    return headers


def tbm_chat_openai(
    model: str = "gpt-4o-mini",
    api_key: str = "tbm_demo_local_key",
    base_url: str = "http://localhost:4000",
    scope: Optional[dict] = None,
    upstream: Optional[str] = None,
    **kwargs: Any,
):
    """Return a LangChain ChatOpenAI bound to the TBM proxy.

    Requires: pip install langchain-openai
    """
    try:
        from langchain_openai import ChatOpenAI  # type: ignore
    except Exception as e:  # pragma: no cover
        raise ImportError("tbm_chat_openai requires `pip install langchain-openai`") from e

    return ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=f"{base_url.rstrip('/')}/v1",
        default_headers=tbm_headers(scope, upstream),
        **kwargs,
    )


def make_tbm_callback_handler(client, scope: Optional[dict] = None):
    """Native LangChain callback that records usage via the TBM SDK.

    Use when calling OpenAI directly (not via the proxy). `client` is a
    `tbm_sdk.TokenBudgetClient`. Requires: pip install langchain-core
    """
    try:
        from langchain_core.callbacks import BaseCallbackHandler  # type: ignore
    except Exception as e:  # pragma: no cover
        raise ImportError("make_tbm_callback_handler requires `pip install langchain-core`") from e

    class TBMCallbackHandler(BaseCallbackHandler):
        def __init__(self, tbm_client, tbm_scope):
            self.client = tbm_client
            self.scope = tbm_scope or {}
            self._pending: Dict[str, Any] = {}

        def on_llm_start(self, serialized, prompts, **kw):  # noqa: D401
            # Pre-flight budget check per prompt (advisory here; the proxy path
            # enforces hard limits). Records intent; enforcement recommended via proxy.
            self._pending["model"] = (serialized or {}).get("kwargs", {}).get("model", "gpt-4o-mini")

        def on_llm_end(self, response, **kw):
            usage = {}
            try:
                usage = response.llm_output.get("token_usage", {}) if response.llm_output else {}
            except Exception:
                usage = {}
            model = self._pending.get("model", "gpt-4o-mini")
            input_tokens = usage.get("prompt_tokens", 0)
            output_tokens = usage.get("completion_tokens", 0)
            # Record via a synthetic tool usage entry so it shows up in analytics.
            try:
                self.client.record_tool_usage(
                    tool=f"langchain:{model}",
                    tool_tokens=input_tokens + output_tokens,
                    model=model,
                    scope=self.scope,
                )
            except Exception:
                pass

    return TBMCallbackHandler(client, scope)


__all__ = ["tbm_chat_openai", "tbm_headers", "make_tbm_callback_handler"]
