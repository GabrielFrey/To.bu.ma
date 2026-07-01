import type { ChatMessage } from '../tokenizer.js';

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  toolTokens: number;
}

export interface CompletionResult {
  content: string;
  model: string;
  usage: CompletionUsage;
}

export interface Provider {
  name: string;
  complete(req: CompletionRequest, apiKey?: string): Promise<CompletionResult>;
}
