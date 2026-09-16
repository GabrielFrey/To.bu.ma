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

/** JSON-schema description of a callable tool, in OpenAI's `tools` shape. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A tool invocation requested by the model. */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * A conversation turn, including prior tool results. `role: 'tool'` messages
 * carry `toolCallId` so the provider can match them to the request that asked.
 */
export interface ChatTurnMessage extends ChatMessage {
  toolCallId?: string;
  /** Tool calls this assistant message previously requested (replayed to the model). */
  toolCalls?: ToolCallRequest[];
}

export interface ChatRequest {
  model: string;
  messages: ChatTurnMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResult {
  content: string;
  model: string;
  usage: CompletionUsage;
  toolCalls: ToolCallRequest[];
  finishReason: 'stop' | 'tool_calls' | 'length';
}

export interface Provider {
  name: string;
  complete(req: CompletionRequest, apiKey?: string): Promise<CompletionResult>;
  /**
   * Tool-calling turn. Optional so a provider can support plain completions
   * only; the assistant refuses to run against a provider without it.
   */
  chat?(req: ChatRequest, apiKey?: string): Promise<ChatResult>;
}
