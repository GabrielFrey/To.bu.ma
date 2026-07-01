import { mockProvider } from './mock.js';
import { openaiProvider } from './openai.js';
import type { Provider } from './types.js';

const providers: Record<string, Provider> = {
  mock: mockProvider,
  openai: openaiProvider,
};

export function getProvider(name: string): Provider {
  const p = providers[name];
  if (!p) throw new Error(`Unknown provider "${name}"`);
  return p;
}

export { mockProvider, openaiProvider };
export type { Provider } from './types.js';
