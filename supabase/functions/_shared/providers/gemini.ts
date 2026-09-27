import { base64Decode, base64Encode } from '../image.ts';
import { FunctionError, optionalEnv, requireEnv } from '../http.ts';

import type { GenerateRequest, GenerateResult, IdeaRequest, ImageProvider } from './types.ts';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 90_000;

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  inline_data?: { mime_type: string; data: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

async function callGemini(model: string, body: unknown): Promise<GeminiResponse> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_ROOT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new FunctionError('provider_error', `Gemini ${response.status}: ${detail.slice(0, 300)}`);
    }

    return (await response.json()) as GeminiResponse;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new FunctionError('provider_timeout', 'Gemini did not answer in time');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const geminiProvider: ImageProvider = {
  name: 'gemini',

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const model = optionalEnv('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image');
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: request.prompt },
            {
              inline_data: {
                mime_type: request.imageMimeType,
                data: base64Encode(request.image),
              },
            },
          ],
        },
      ],
      generationConfig: { responseModalities: ['IMAGE'] },
    };

    const result = await callGemini(model, payload);

    if (result.promptFeedback?.blockReason) {
      throw new FunctionError('moderation_blocked', result.promptFeedback.blockReason);
    }

    const parts = result.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((part) => part.inlineData?.data ?? part.inline_data?.data);
    const data = imagePart?.inlineData?.data ?? imagePart?.inline_data?.data;

    if (!data) {
      throw new FunctionError('provider_error', 'Gemini returned no image part');
    }

    return { png: base64Decode(data), provider: 'gemini', model };
  },

  async suggestIdeas(request: IdeaRequest): Promise<string[]> {
    const model = optionalEnv('GEMINI_TEXT_MODEL', 'gemini-2.5-flash');
    const result = await callGemini(model, {
      contents: [
        {
          role: 'user',
          parts: [{ text: ideaPrompt(request) }],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', temperature: 1.1 },
    });

    const text = result.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text ?? '';
    return parseIdeas(text, request.count);
  },
};

export function ideaPrompt({ topic, locale, count }: IdeaRequest): string {
  return [
    `Suggest ${count} short sticker scene ideas about "${topic}".`,
    'Each idea describes the pose, expression and one or two props for a die-cut messaging sticker of a person or pet.',
    'Keep every idea under 90 characters, safe for all audiences, no celebrities, no brands, no text overlays.',
    `Write the ideas in the language with the code "${locale}".`,
    'Answer with a JSON array of strings and nothing else.',
  ].join(' ');
}

export function parseIdeas(raw: string, count: number): string[] {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, count);
    }
  } catch {
    // Fall through to line parsing: models occasionally answer with a bullet list.
  }
  return trimmed
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s"]+/, '').replace(/[",]+$/, '').trim())
    .filter((line) => line.length > 3)
    .slice(0, count);
}
