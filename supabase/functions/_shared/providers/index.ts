import { optionalEnv } from '../http.ts';

import { geminiProvider } from './gemini.ts';
import { openAiProvider } from './openai.ts';
import type { ImageProvider } from './types.ts';

export type { GenerateRequest, GenerateResult, IdeaRequest, ImageProvider } from './types.ts';

/** Swapping providers is an env change, never a code change at the call sites. */
export function imageProvider(): ImageProvider {
  const configured = optionalEnv('IMAGE_PROVIDER', 'gemini').toLowerCase();
  switch (configured) {
    case 'openai':
      return openAiProvider;
    case 'gemini':
      return geminiProvider;
    default:
      console.warn(`Unknown IMAGE_PROVIDER "${configured}", falling back to gemini`);
      return geminiProvider;
  }
}
