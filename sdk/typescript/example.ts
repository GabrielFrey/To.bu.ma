/**
 * Copy-paste TypeScript integration example.
 *
 * Run (with the backend seeded + running on :4000):
 *   npm run example
 *
 * Integrating into an existing agent takes ~4 lines: construct the client,
 * call beforeLLMCall(), enforceBudget(), then afterLLMCall() with real usage.
 */
import { TokenBudgetClient, BudgetExceededError } from './src/index.js';

const tbm = new TokenBudgetClient({
  baseUrl: process.env.TBM_URL ?? 'http://localhost:4000',
  apiKey: process.env.TBM_API_KEY ?? 'tbm_demo_local_key',
  scope: { agentId: process.env.TBM_AGENT_ID }, // optional default scope
});

async function myAgentStep(userMessage: string) {
  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: userMessage },
  ];

  // 1. Pre-flight budget check (forecast + policy decision + reservation).
  const check = await tbm.beforeLLMCall({ model: 'gpt-4o-mini', messages, expectedCompletionTokens: 128 });
  try {
    tbm.enforceBudget(check); // throws BudgetExceededError if blocked
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      console.log(`Blocked by budget policy: ${e.decision} — ${e.check.reason}`);
      return null;
    }
    throw e;
  }

  // 2. Optionally honor an optimization hint (cheaper model / compression).
  const model = check.recommendedModel ?? 'gpt-4o-mini';

  // 3. Make YOUR real LLM call here. We use the server's mock provider so this
  //    example runs offline; swap for your OpenAI client in production.
  const result = await tbm.complete({ model, messages, provider: 'mock', maxTokens: 128 });

  // 4. Record actuals (idempotent). If you called OpenAI directly, pass its
  //    `usage` object to afterLLMCall({ requestId: check.requestId!, usage }).
  console.log('assistant:', result.content);
  console.log('accounted usage:', result.usage);
  return result;
}

await myAgentStep('Summarize why my charger station keeps going offline.');
