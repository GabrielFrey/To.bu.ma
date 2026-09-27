import { base64Decode } from '../image.ts';
import { FunctionError, optionalEnv, requireEnv } from '../http.ts';

import { ideaPrompt, parseIdeas } from './gemini.ts';
import type { GenerateRequest, GenerateResult, IdeaRequest, ImageProvider } from './types.ts';

const TIMEOUT_MS = 120_000;

interface ImageEditResponse {
  data?: { b64_json?: string }[];
  error?: { message?: string };
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

export const openAiProvider: ImageProvider = {
  name: 'openai',

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const apiKey = requireEnv('OPENAI_API_KEY');
    const model = optionalEnv('OPENAI_IMAGE_MODEL', 'gpt-image-1');

    const form = new FormData();
    form.append('model', model);
    form.append('prompt', request.prompt);
    form.append('size', '1024x1024');
    form.append('background', 'transparent');
    form.append('output_format', 'png');
    form.append('n', '1');
    form.append(
      'image',
      new Blob([request.image as BlobPart], { type: request.imageMimeType }),
      'source.png',
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });

      const payload = (await response.json()) as ImageEditResponse;

      if (!response.ok) {
        const message = payload.error?.message ?? `status ${response.status}`;
        if (/safety|moderation|policy/i.test(message)) {
          throw new FunctionError('moderation_blocked', message);
        }
        throw new FunctionError('provider_error', `OpenAI: ${message}`);
      }

      const b64 = payload.data?.[0]?.b64_json;
      if (!b64) {
        throw new FunctionError('provider_error', 'OpenAI returned no image');
      }

      return { png: base64Decode(b64), provider: 'openai', model };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new FunctionError('provider_timeout', 'OpenAI did not answer in time');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  },

  async suggestIdeas(request: IdeaRequest): Promise<string[]> {
    const apiKey = requireEnv('OPENAI_API_KEY');
    const model = optionalEnv('OPENAI_TEXT_MODEL', 'gpt-4.1-mini');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 1.1,
        messages: [{ role: 'user', content: ideaPrompt(request) }],
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new FunctionError('provider_error', `OpenAI ideas: status ${response.status}`);
    }

    const payload = (await response.json()) as ChatResponse;
    const content = payload.choices?.[0]?.message?.content ?? '';
    // json_object mode wraps arrays in an object, so try both shapes.
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const firstArray = Object.values(parsed).find((value) => Array.isArray(value));
      if (Array.isArray(firstArray)) {
        return firstArray
          .filter((item): item is string => typeof item === 'string')
          .slice(0, request.count);
      }
    } catch {
      // Fall through to the shared text parser.
    }
    return parseIdeas(content, request.count);
  },
};
