/**
 * Framework middleware examples (TypeScript). Both route through the TBM proxy,
 * so budgets/policies/optimization apply automatically.
 *
 * Install the framework you use:
 *   npm i ai @ai-sdk/openai          # Vercel AI SDK
 *   npm i @langchain/openai @langchain/core   # LangChain.js
 */
import { tbmOpenAIProvider, tbmChatOpenAI } from './src/index.js';

const connect = {
  baseUrl: process.env.TBM_URL ?? 'http://localhost:4000',
  apiKey: process.env.TBM_API_KEY ?? 'tbm_demo_local_key',
  scope: { agent: 'framework-demo', task: 'summary' },
  upstream: (process.env.TBM_UPSTREAM as 'mock' | 'openai') ?? 'mock',
};

async function vercelAiExample() {
  // import { generateText } from 'ai';
  const openai = await tbmOpenAIProvider(connect);
  // const { text } = await generateText({ model: openai('gpt-4o-mini'), prompt: 'Write a haiku.' });
  // console.log(text);
  return openai;
}

async function langchainExample() {
  const model = await tbmChatOpenAI(connect, { model: 'gpt-4o-mini' });
  // const res = await model.invoke('Write a haiku about budgets.');
  // console.log(res.content);
  return model;
}

void vercelAiExample;
void langchainExample;
console.log('Configured TBM adapters for Vercel AI SDK and LangChain.js (uncomment calls after installing the frameworks).');
