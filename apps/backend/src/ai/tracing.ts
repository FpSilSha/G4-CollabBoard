import Anthropic from '@anthropic-ai/sdk';
import { traceable } from 'langsmith/traceable';
import type { ViewportBounds, AICommandResponse } from 'shared';
import { logger } from '../utils/logger';

// ============================================================
// LangSmith Tracing Wrappers
// ============================================================
//
// Uses the lightweight `langsmith` SDK with `traceable` wrappers.
// Not full LangChain — just the tracing primitives.
//
// Trace tree structure:
//   collabboard-ai-command (chain) — top-level, shows user command as input
//   ├── anthropic-tool-use (llm) — Turn 1
//   ├── tool-execution: createFrame (tool)
//   ├── anthropic-tool-use (llm) — Turn 2
//   └── metadata: { userId, boardId, command, costCents }

/** Shared Anthropic client — singleton (reuses connections). */
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

/**
 * Whether LangSmith tracing is enabled.
 * Checks LANGCHAIN_TRACING_V2 env var + API key presence.
 */
export function isTracingEnabled(): boolean {
  return process.env.LANGCHAIN_TRACING_V2 === 'true' &&
         !!process.env.LANGCHAIN_API_KEY;
}

/**
 * Wrapped Anthropic messages.create call with LangSmith tracing.
 * Falls back to a direct call if LangSmith is not configured.
 */
export const tracedAnthropicCall = traceable(
  async (params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
    const client = getAnthropicClient();
    return await client.messages.create(params);
  },
  { name: 'anthropic-tool-use', run_type: 'llm' }
);

/**
 * Wrapped tool execution with LangSmith tracing.
 * The actual execution is done by toolExecutor.execute() — this wrapper
 * just adds it to the trace tree.
 */
export const tracedToolExecution = traceable(
  async (
    toolName: string,
    input: unknown,
    boardId: string,
    userId: string,
    viewport: ViewportBounds,
    executeFn: (
      toolName: string,
      input: unknown,
      boardId: string,
      userId: string,
      viewport: ViewportBounds
    ) => Promise<unknown>
  ): Promise<unknown> => {
    return await executeFn(toolName, input, boardId, userId, viewport);
  },
  { name: 'tool-execution', run_type: 'tool' }
);

/**
 * Top-level trace wrapper for the entire AI command execution.
 * This creates the parent "chain" in LangSmith that shows the user's
 * command as its Input. All nested tracedAnthropicCall / tracedToolExecution
 * calls become children of this trace.
 *
 * The first argument is the trace input — LangSmith displays it as the
 * run's Input in the UI. The function return value becomes the Output.
 */
export const tracedCommandExecution = traceable(
  async (
    input: { command: string; boardId: string; userId: string; model: string },
    executeFn: () => Promise<AICommandResponse>
  ): Promise<AICommandResponse> => {
    return await executeFn();
  },
  { name: 'collabboard-ai-command', run_type: 'chain' }
);

/**
 * Get the current LangSmith trace/run ID if available.
 * Returns undefined if tracing is not active.
 */
export function getCurrentTraceId(): string | undefined {
  // LangSmith traceable doesn't expose a simple "get current trace ID" API.
  // The trace ID is set by the `traceable` wrapper at the top-level call.
  // For now, we return undefined and rely on LangSmith's auto-correlation.
  // The trace ID is visible in the LangSmith UI.
  return undefined;
}
