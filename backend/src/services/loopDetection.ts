import { createHash } from 'node:crypto';
import { prisma } from '../db.js';
import type { ChatMessage } from '../tokenizer.js';

/** Signature = hash(normalized prompt + model) to detect near-identical repeats. */
export function requestSignature(input: string | ChatMessage[], model: string): string {
  const text = typeof input === 'string' ? input : input.map((m) => `${m.role}:${m.content}`).join('\n');
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${model}::${normalized}`).digest('hex').slice(0, 32);
}

export interface LoopSignals {
  signatureRepeats: number; // how many times this exact signature already ran in the session
  failedAttempts: number; // failed requests on this task
  isLoop: boolean;
  isRepeatedFailure: boolean;
}

export async function detectLoopSignals(params: {
  sessionId?: string | null;
  taskId?: string | null;
  signature: string;
  loopThreshold: number;
  retryThreshold: number;
}): Promise<LoopSignals> {
  const { sessionId, taskId, signature, loopThreshold, retryThreshold } = params;

  const signatureRepeats = sessionId
    ? await prisma.llmRequest.count({ where: { sessionId, signature } })
    : 0;

  const failedAttempts = taskId
    ? await prisma.llmRequest.count({ where: { taskId, status: 'failed' } })
    : 0;

  return {
    signatureRepeats,
    failedAttempts,
    isLoop: signatureRepeats >= loopThreshold,
    isRepeatedFailure: failedAttempts >= retryThreshold,
  };
}
