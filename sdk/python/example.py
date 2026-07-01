"""Copy-paste Python integration example.

Run (with the backend seeded + running on :4000):
    python example.py

Integrating into an existing agent takes ~4 lines: construct the client,
call before_llm_call(), enforce_budget(), then after_llm_call() with real usage.
"""
import os

from tbm_sdk import TokenBudgetClient, BudgetExceededError

tbm = TokenBudgetClient(
    api_key=os.environ.get("TBM_API_KEY", "tbm_demo_local_key"),
    base_url=os.environ.get("TBM_URL", "http://localhost:4000"),
    scope={"agentId": os.environ.get("TBM_AGENT_ID")} if os.environ.get("TBM_AGENT_ID") else None,
)


def my_agent_step(user_message: str):
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": user_message},
    ]

    # 1. Pre-flight budget check.
    check = tbm.before_llm_call(model="gpt-4o-mini", messages=messages, expected_completion_tokens=128)
    try:
        tbm.enforce_budget(check)  # raises BudgetExceededError if blocked
    except BudgetExceededError as e:
        print(f"Blocked by budget policy: {e.decision} — {e.check.reason}")
        return None

    # 2. Honor any optimization hint.
    model = check.recommendedModel or "gpt-4o-mini"

    # 3. Make YOUR real LLM call. Here we use the server's mock provider so the
    #    example runs offline; in production call OpenAI and pass its usage below.
    result = tbm.complete(model=model, messages=messages, provider="mock", max_tokens=128)
    print("assistant:", result["content"])
    print("accounted usage:", result["usage"])
    return result


if __name__ == "__main__":
    my_agent_step("Summarize why my charger station keeps going offline.")
