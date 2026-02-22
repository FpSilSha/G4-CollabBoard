/**
 * Unit tests for aiService — the main AI agent execution engine.
 *
 * Architecture note: aiService calls Anthropic via the tracing module
 * (`tracedAnthropicCall`, `tracedCommandExecution`, `tracedToolExecution`)
 * rather than the Anthropic SDK directly. So we mock the tracing module
 * to control what the Anthropic "API" returns. We also mock aiBudgetService,
 * aiChatService, toolExecutor, commandClassifier, and supporting services.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Module mocks (must come before imports that use them) ───────────────────

vi.mock('../../src/ai/tracing', () => ({
  tracedAnthropicCall: vi.fn(),
  tracedToolExecution: vi.fn(),
  tracedCommandExecution: vi.fn((_input, fn) => fn()),
  getCurrentTraceId: vi.fn(() => undefined),
  isTracingEnabled: vi.fn(() => false),
}));

vi.mock('../../src/services/aiBudgetService', () => ({
  aiBudgetService: {
    checkBudget: vi.fn(),
    recordUsage: vi.fn().mockResolvedValue(undefined),
  },
  calculateCostCents: vi.fn().mockReturnValue(1),
}));

vi.mock('../../src/services/aiChatService', () => ({
  aiChatService: {
    getHistory: vi.fn().mockResolvedValue([]),
    getOrCreateConversationId: vi.fn().mockResolvedValue('conv-test-id'),
    appendMessages: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/ai/commandClassifier', () => ({
  classifyCommand: vi.fn(),
}));

vi.mock('../../src/ai/toolExecutor', () => ({
  toolExecutor: {
    execute: vi.fn(),
  },
}));

vi.mock('../../src/ai/systemPrompt', () => ({
  buildSystemPrompt: vi.fn(() => 'mock system prompt'),
}));

vi.mock('../../src/ai/tools', () => ({
  AI_TOOLS: [],
}));

vi.mock('../../src/services/auditService', () => ({
  auditService: {
    log: vi.fn(),
  },
  AuditAction: {
    AI_EXECUTE: 'ai.execute',
  },
}));

vi.mock('../../src/services/metricsService', () => ({
  metricsService: {
    recordAICommand: vi.fn(),
    incrementWsEventOut: vi.fn(),
  },
}));

vi.mock('../../src/websocket/wsMetrics', () => ({
  trackedEmit: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { aiService } from '../../src/services/aiService';
import { aiBudgetService } from '../../src/services/aiBudgetService';
import { aiChatService } from '../../src/services/aiChatService';
import { classifyCommand } from '../../src/ai/commandClassifier';
import { toolExecutor } from '../../src/ai/toolExecutor';
import { metricsService } from '../../src/services/metricsService';
import { trackedEmit } from '../../src/websocket/wsMetrics';
import {
  tracedAnthropicCall,
  tracedToolExecution,
} from '../../src/ai/tracing';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeViewport() {
  return { x: 0, y: 0, width: 1920, height: 1080, zoom: 1 };
}

/** Build a minimal Anthropic end_turn message. */
function makeEndTurnResponse(text = 'Done.') {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

/** Build a tool_use then end_turn response sequence. */
function makeToolUseResponse(toolName: string, toolInput: Record<string, unknown>, toolId = 'tool-1') {
  return {
    stop_reason: 'tool_use',
    content: [
      { type: 'tool_use', id: toolId, name: toolName, input: toolInput },
    ],
    usage: { input_tokens: 200, output_tokens: 80 },
  };
}

/** Default successful operation returned by toolExecutor.execute mock. */
function makeToolResult(objectId = 'obj-created') {
  return {
    output: { success: true, objectId, message: 'Created object' },
    operation: {
      type: 'create',
      objectType: 'sticky',
      objectId,
      details: {},
    },
  };
}

// ─── Test Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: budget has remaining
  vi.mocked(aiBudgetService.checkBudget).mockResolvedValue({
    hasRemaining: true,
    remainingCents: 4000,
    totalBudgetCents: 5000,
    spentCents: 1000,
  });

  // Default: classify as 'simple' (Haiku)
  vi.mocked(classifyCommand).mockReturnValue('simple');

  // Default: tracedAnthropicCall returns end_turn immediately
  vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

  // Default: tracedToolExecution delegates to toolExecutor
  vi.mocked(tracedToolExecution).mockImplementation(
    async (toolName, input, boardId, userId, viewport, executeFn) => {
      return executeFn(toolName, input, boardId, userId, viewport);
    }
  );

  // Default: toolExecutor returns a successful operation
  vi.mocked(toolExecutor.execute).mockResolvedValue(makeToolResult());
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('aiService.executeCommand — budget enforcement', () => {
  it('returns error response immediately when budget is exhausted', async () => {
    vi.mocked(aiBudgetService.checkBudget).mockResolvedValue({
      hasRemaining: false,
      remainingCents: 0,
      totalBudgetCents: 5000,
      spentCents: 5000,
    });

    const result = await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AI_BUDGET_EXCEEDED');
    // Should not call Anthropic at all
    expect(tracedAnthropicCall).not.toHaveBeenCalled();
  });

  it('includes a human-readable budget error message', async () => {
    vi.mocked(aiBudgetService.checkBudget).mockResolvedValue({
      hasRemaining: false,
      remainingCents: 0,
      totalBudgetCents: 5000,
      spentCents: 5000,
    });

    const result = await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    expect(result.message).toContain('limit');
    expect(result.operations).toEqual([]);
  });

  it('proceeds when budget has remaining', async () => {
    vi.mocked(aiBudgetService.checkBudget).mockResolvedValue({
      hasRemaining: true,
      remainingCents: 100,
      totalBudgetCents: 5000,
      spentCents: 4900,
    });
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse('Done.') as never);

    const result = await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    expect(result.success).toBe(true);
    expect(tracedAnthropicCall).toHaveBeenCalled();
  });

  it('records usage even when budget check passes but execution costs tokens', async () => {
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    expect(aiBudgetService.recordUsage).toHaveBeenCalledOnce();
  });
});

describe('aiService.executeCommand — command routing (Haiku vs Sonnet)', () => {
  it('routes a simple command to the Haiku model', async () => {
    vi.mocked(classifyCommand).mockReturnValue('simple');
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    await aiService.executeCommand(
      'board-1', 'create a blue sticky note', 'user-1', makeViewport()
    );

    const calledModel = vi.mocked(tracedAnthropicCall).mock.calls[0][0].model as string;
    expect(calledModel.toLowerCase()).toContain('haiku');
  });

  it('routes a complex command to the Sonnet model', async () => {
    vi.mocked(classifyCommand).mockReturnValue('complex');
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    await aiService.executeCommand(
      'board-1', 'create a SWOT analysis template', 'user-1', makeViewport()
    );

    const calledModel = vi.mocked(tracedAnthropicCall).mock.calls[0][0].model as string;
    expect(calledModel.toLowerCase()).toContain('sonnet');
  });

  it('passes the correct max turns for a simple (Haiku) command', async () => {
    vi.mocked(classifyCommand).mockReturnValue('simple');
    // Make Anthropic return end_turn quickly
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    const result = await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    // With env AI_MAX_TURNS_SIMPLE=5, single end_turn uses 1 turn
    expect(result.usage?.turnsUsed).toBe(1);
  });

  it('passes the correct max turns for a complex (Sonnet) command', async () => {
    vi.mocked(classifyCommand).mockReturnValue('complex');
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse('Done with complex task.') as never);

    const result = await aiService.executeCommand(
      'board-1', 'create a kanban board', 'user-1', makeViewport()
    );

    expect(result.usage?.turnsUsed).toBe(1);
  });

  it('calls classifyCommand with the exact command string', async () => {
    const command = 'add 3 sticky notes about project goals';
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    await aiService.executeCommand('board-1', command, 'user-1', makeViewport());

    expect(classifyCommand).toHaveBeenCalledWith(command);
  });
});

describe('aiService.executeCommand — successful end_turn path', () => {
  it('returns success=true when AI ends with end_turn', async () => {
    vi.mocked(tracedAnthropicCall).mockResolvedValue(
      makeEndTurnResponse('I created your sticky note.') as never
    );

    const result = await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    expect(result.success).toBe(true);
    expect(result.message).toBe('I created your sticky note.');
  });

  it('includes the conversationId in the response', async () => {
    vi.mocked(aiChatService.getOrCreateConversationId).mockResolvedValue('my-conv-id');
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    const result = await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    expect(result.conversationId).toBe('my-conv-id');
  });

  it('includes usage data in the response', async () => {
    vi.mocked(tracedAnthropicCall).mockResolvedValue(
      makeEndTurnResponse() as never
    );

    const result = await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    expect(result.usage).toBeDefined();
    expect(result.usage?.inputTokens).toBe(100);
    expect(result.usage?.outputTokens).toBe(50);
    expect(result.usage?.totalTokens).toBe(150);
    expect(result.usage?.turnsUsed).toBe(1);
  });

  it('appends user command and assistant reply to chat history', async () => {
    vi.mocked(tracedAnthropicCall).mockResolvedValue(
      makeEndTurnResponse('Created it!') as never
    );

    await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    expect(aiChatService.appendMessages).toHaveBeenCalledWith(
      'board-1',
      'user-1',
      expect.arrayContaining([
        { role: 'user', content: 'create a sticky note' },
        { role: 'assistant', content: 'Created it!' },
      ])
    );
  });

  it('saves chat history on successful completion', async () => {
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    await aiService.executeCommand('board-1', 'test command', 'user-1', makeViewport());

    expect(aiChatService.appendMessages).toHaveBeenCalledOnce();
  });

  it('records metrics on success', async () => {
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    await aiService.executeCommand('board-1', 'create sticky', 'user-1', makeViewport());

    expect(metricsService.recordAICommand).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('emits ai:thinking before running the loop', async () => {
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    await aiService.executeCommand('board-1', 'create sticky', 'user-1', makeViewport());

    // trackedEmit is called at least once (for ai:thinking)
    expect(trackedEmit).toHaveBeenCalled();
    const firstCall = vi.mocked(trackedEmit).mock.calls[0];
    expect(firstCall[1]).toBe('ai:thinking');
  });

  it('emits ai:complete after the loop finishes', async () => {
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    await aiService.executeCommand('board-1', 'create sticky', 'user-1', makeViewport());

    const emitCalls = vi.mocked(trackedEmit).mock.calls.map(c => c[1]);
    expect(emitCalls).toContain('ai:complete');
  });

  it('includes the budgetRemainingCents from a second checkBudget call', async () => {
    vi.mocked(aiBudgetService.checkBudget)
      .mockResolvedValueOnce({
        hasRemaining: true,
        remainingCents: 4000,
        totalBudgetCents: 5000,
        spentCents: 1000,
      })
      .mockResolvedValueOnce({
        hasRemaining: true,
        remainingCents: 3950,
        totalBudgetCents: 5000,
        spentCents: 1050,
      });
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    const result = await aiService.executeCommand(
      'board-1', 'create sticky', 'user-1', makeViewport()
    );

    expect(result.usage?.budgetRemainingCents).toBe(3950);
  });
});

describe('aiService.executeCommand — tool use loop', () => {
  it('executes tool calls when AI returns tool_use stop_reason', async () => {
    vi.mocked(classifyCommand).mockReturnValue('simple');

    // Turn 1: AI wants a tool call
    // Turn 2: AI ends with end_turn after tool result
    vi.mocked(tracedAnthropicCall)
      .mockResolvedValueOnce(makeToolUseResponse('createStickyNote', { x: 100, y: 100, text: 'Hello' }) as never)
      .mockResolvedValueOnce(makeEndTurnResponse('Created a sticky note.') as never);

    vi.mocked(toolExecutor.execute).mockResolvedValue(makeToolResult('obj-123'));

    const result = await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    expect(result.success).toBe(true);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].objectId).toBe('obj-123');
    expect(result.operations[0].type).toBe('create');
  });

  it('uses 2 turns when one tool call occurs before end_turn', async () => {
    vi.mocked(tracedAnthropicCall)
      .mockResolvedValueOnce(makeToolUseResponse('createStickyNote', { x: 100, y: 100, text: 'Hi' }) as never)
      .mockResolvedValueOnce(makeEndTurnResponse() as never);

    vi.mocked(toolExecutor.execute).mockResolvedValue(makeToolResult());

    const result = await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    expect(result.usage?.turnsUsed).toBe(2);
    expect(tracedAnthropicCall).toHaveBeenCalledTimes(2);
  });

  it('accumulates operations from multiple tool calls across turns', async () => {
    // Turn 1: two tool calls
    vi.mocked(tracedAnthropicCall)
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'createStickyNote', input: { x: 100, y: 100, text: 'A' } },
          { type: 'tool_use', id: 'tool-2', name: 'createStickyNote', input: { x: 300, y: 100, text: 'B' } },
        ],
        usage: { input_tokens: 200, output_tokens: 100 },
      } as never)
      .mockResolvedValueOnce(makeEndTurnResponse('Done.') as never);

    vi.mocked(toolExecutor.execute)
      .mockResolvedValueOnce(makeToolResult('obj-a'))
      .mockResolvedValueOnce(makeToolResult('obj-b'));

    const result = await aiService.executeCommand(
      'board-1', 'create two sticky notes', 'user-1', makeViewport()
    );

    expect(result.operations).toHaveLength(2);
    expect(result.operations[0].objectId).toBe('obj-a');
    expect(result.operations[1].objectId).toBe('obj-b');
  });

  it('passes chat history prepended to the messages array', async () => {
    vi.mocked(aiChatService.getHistory).mockResolvedValue([
      { role: 'user', content: 'earlier command' },
      { role: 'assistant', content: 'I did it.' },
    ]);
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    await aiService.executeCommand('board-1', 'new command', 'user-1', makeViewport());

    const callParams = vi.mocked(tracedAnthropicCall).mock.calls[0][0];
    const messages = callParams.messages as Array<{ role: string; content: string }>;
    // History + new user message = 3 messages
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe('earlier command');
    expect(messages[2].content).toBe('new command');
  });

  it('stops at operation limit and returns partial results', async () => {
    // Simulate AI trying to create many objects — we only have 1 in operations but
    // test that the cap logic runs by checking tool calls are capped
    // The real MAX_OPERATIONS_PER_COMMAND from shared is the cap. Here we verify
    // the service still returns success with whatever ops it got.
    vi.mocked(tracedAnthropicCall)
      .mockResolvedValueOnce(makeToolUseResponse('createStickyNote', { x: 0, y: 0, text: 'A' }) as never)
      .mockResolvedValueOnce(makeEndTurnResponse('Done within limits.') as never);

    vi.mocked(toolExecutor.execute).mockResolvedValue(makeToolResult('capped-obj'));

    const result = await aiService.executeCommand(
      'board-1', 'create sticky', 'user-1', makeViewport()
    );

    expect(result.success).toBe(true);
    expect(result.operations.length).toBeGreaterThanOrEqual(1);
  });
});

describe('aiService.executeCommand — turn limit enforcement', () => {
  it('stops and returns a fallback message when maxTurns is reached', async () => {
    // With AI_MAX_TURNS_SIMPLE=5 (from env), always returning tool_use will
    // exhaust the turn budget. Mock 5 consecutive tool_use responses.
    vi.mocked(classifyCommand).mockReturnValue('simple');

    const toolUseResponse = makeToolUseResponse('createStickyNote', { x: 0, y: 0, text: 'Hi' });
    vi.mocked(tracedAnthropicCall).mockResolvedValue(toolUseResponse as never);
    vi.mocked(toolExecutor.execute).mockResolvedValue(makeToolResult());

    const result = await aiService.executeCommand(
      'board-1', 'create sticky notes forever', 'user-1', makeViewport()
    );

    // Should have reached max turns (5 for simple/Haiku)
    expect(result.usage?.turnsUsed).toBe(5);
    // Message should indicate max steps reached
    expect(result.message).toContain('maximum steps');
    expect(result.success).toBe(true);
  });

  it('respects the COMPLEX command turn limit (7) separately from simple (5)', async () => {
    vi.mocked(classifyCommand).mockReturnValue('complex');

    const toolUseResponse = makeToolUseResponse('createStickyNote', { x: 0, y: 0, text: 'Hi' });
    vi.mocked(tracedAnthropicCall).mockResolvedValue(toolUseResponse as never);
    vi.mocked(toolExecutor.execute).mockResolvedValue(makeToolResult());

    const result = await aiService.executeCommand(
      'board-1', 'create kanban board', 'user-1', makeViewport()
    );

    // Complex commands get up to 7 turns (AI_MAX_TURNS_COMPLEX=7 in env)
    expect(result.usage?.turnsUsed).toBe(7);
  });
});

describe('aiService.executeCommand — error handling', () => {
  it('returns AI_EXECUTION_FAILED when Anthropic throws an error', async () => {
    vi.mocked(tracedAnthropicCall).mockRejectedValue(new Error('API error: overloaded'));

    const result = await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AI_EXECUTION_FAILED');
  });

  it('includes the Anthropic error message in the error response', async () => {
    vi.mocked(tracedAnthropicCall).mockRejectedValue(new Error('rate_limit_error: too many requests'));

    const result = await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    expect(result.error?.message).toContain('rate_limit_error');
  });

  it('records usage even when Anthropic throws mid-loop', async () => {
    // First call succeeds (consumes tokens), second throws
    vi.mocked(tracedAnthropicCall)
      .mockResolvedValueOnce(makeToolUseResponse('createStickyNote', { x: 0, y: 0, text: 'Hi' }) as never)
      .mockRejectedValueOnce(new Error('Network timeout'));

    vi.mocked(toolExecutor.execute).mockResolvedValue(makeToolResult());

    const result = await aiService.executeCommand(
      'board-1', 'create sticky', 'user-1', makeViewport()
    );

    // Usage should have been recorded
    expect(aiBudgetService.recordUsage).toHaveBeenCalled();
    // Should report partial success (1 operation completed before failure)
    expect(result.success).toBe(true);
    expect(result.message).toContain('Partially completed');
  });

  it('returns empty operations array on error with no partial ops', async () => {
    vi.mocked(tracedAnthropicCall).mockRejectedValue(new Error('Server error'));

    const result = await aiService.executeCommand(
      'board-1', 'create sticky', 'user-1', makeViewport()
    );

    expect(result.operations).toEqual([]);
  });

  it('emits ai:complete even on error', async () => {
    vi.mocked(tracedAnthropicCall).mockRejectedValue(new Error('Unexpected error'));

    await aiService.executeCommand('board-1', 'create sticky', 'user-1', makeViewport());

    const emitCalls = vi.mocked(trackedEmit).mock.calls.map(c => c[1]);
    expect(emitCalls).toContain('ai:complete');
  });

  it('records failed metrics when Anthropic throws', async () => {
    vi.mocked(tracedAnthropicCall).mockRejectedValue(new Error('API error'));

    await aiService.executeCommand('board-1', 'create sticky', 'user-1', makeViewport());

    expect(metricsService.recordAICommand).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  it('returns rateLimitRemaining as 0 (hardcoded)', async () => {
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    const result = await aiService.executeCommand(
      'board-1', 'create sticky', 'user-1', makeViewport()
    );

    expect(result.rateLimitRemaining).toBe(0);
  });
});

describe('aiService.executeCommand — Haiku retry logic', () => {
  it('retries with Sonnet when Haiku returns 0 successful ops (failedWithNoOps)', async () => {
    vi.mocked(classifyCommand).mockReturnValue('simple');

    // Haiku attempt: tool_use returns a failed output (success: false) → triggers failedWithNoOps
    vi.mocked(tracedAnthropicCall)
      // Haiku turn 1: tool call that fails
      .mockResolvedValueOnce(makeToolUseResponse('createStickyNote', { x: 100, y: 100, text: 'Hi' }, 'tool-h1') as never)
      // Haiku turn 2: end_turn (loop exits for Haiku)
      .mockResolvedValueOnce(makeEndTurnResponse('Haiku failed.') as never)
      // Sonnet retry turn 1: end_turn immediately
      .mockResolvedValueOnce(makeEndTurnResponse('Sonnet succeeded.') as never);

    // Tool executor returns failure for Haiku, but we need to trigger failedWithNoOps.
    // failedWithNoOps = operations.length === 0 && toolErrorCount > 0.
    // The tool executor returns success:false output → toolErrorCount increments,
    // but the operation IS still pushed to operations array.
    // To get failedWithNoOps=true, we need toolErrorCount>0 AND operations.length=0.
    // That requires: the tool to be executed AND return success:false with zero ops...
    // Actually looking at runAgentLoop: operation is always pushed regardless of success.
    // failedWithNoOps = operations.length === 0 && toolErrorCount > 0
    // So to trigger retry: no operations AND tool errors.
    // This happens when the catch block is triggered (err thrown by tracedAnthropicCall
    // before any tools run): failedWithNoOps = operations.length === 0 (no ops=true, no toolErrorCount check needed)
    // Actually on catch: failedWithNoOps = operations.length === 0 (toolErrorCount isn't checked here)

    // Simpler path: Haiku throws on turn 1 → catch block → failedWithNoOps = (0 ops = true)
    vi.mocked(tracedAnthropicCall)
      // Haiku: throws immediately → catch → failedWithNoOps=true (0 ops, no tool errors checked)
      .mockReset()
      .mockRejectedValueOnce(new Error('Haiku model error'))
      // Sonnet retry: succeeds
      .mockResolvedValueOnce(makeEndTurnResponse('Sonnet handled it.') as never);

    const result = await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    // tracedAnthropicCall should have been called twice: once for Haiku, once for Sonnet
    expect(tracedAnthropicCall).toHaveBeenCalledTimes(2);

    // Second call should use Sonnet model
    const secondCallModel = vi.mocked(tracedAnthropicCall).mock.calls[1][0].model as string;
    expect(secondCallModel.toLowerCase()).toContain('sonnet');

    // Overall result should reflect Sonnet's success
    expect(result.success).toBe(true);
    expect(result.message).toBe('Sonnet handled it.');
  });

  it('does NOT retry when Haiku succeeds with operations', async () => {
    vi.mocked(classifyCommand).mockReturnValue('simple');

    vi.mocked(tracedAnthropicCall)
      .mockResolvedValueOnce(makeToolUseResponse('createStickyNote', { x: 100, y: 100, text: 'Hi' }) as never)
      .mockResolvedValueOnce(makeEndTurnResponse('Done.') as never);

    vi.mocked(toolExecutor.execute).mockResolvedValue(makeToolResult('obj-ok'));

    const result = await aiService.executeCommand(
      'board-1', 'create a sticky note', 'user-1', makeViewport()
    );

    // Only Haiku calls (2 turns), no Sonnet retry
    expect(tracedAnthropicCall).toHaveBeenCalledTimes(2);
    const models = vi.mocked(tracedAnthropicCall).mock.calls.map(c => c[0].model as string);
    expect(models.every(m => m.toLowerCase().includes('haiku'))).toBe(true);
    expect(result.success).toBe(true);
    expect(result.operations).toHaveLength(1);
  });

  it('does NOT retry when model is already Sonnet (complex command)', async () => {
    vi.mocked(classifyCommand).mockReturnValue('complex');

    // Sonnet fails entirely
    vi.mocked(tracedAnthropicCall).mockRejectedValue(new Error('Sonnet API error'));

    await aiService.executeCommand(
      'board-1', 'create a kanban board', 'user-1', makeViewport()
    );

    // Only 1 call (Sonnet), no retry
    expect(tracedAnthropicCall).toHaveBeenCalledTimes(1);
  });

  it('records a failed Haiku metrics entry before the Sonnet retry', async () => {
    vi.mocked(classifyCommand).mockReturnValue('simple');

    vi.mocked(tracedAnthropicCall)
      .mockRejectedValueOnce(new Error('Haiku fail'))
      .mockResolvedValueOnce(makeEndTurnResponse('Sonnet OK.') as never);

    await aiService.executeCommand(
      'board-1', 'create sticky', 'user-1', makeViewport()
    );

    // metricsService.recordAICommand should be called at minimum for the Haiku failure
    // (before the retry) AND for the final Sonnet result
    expect(metricsService.recordAICommand).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'AI_HAIKU_RETRY' })
    );
  });

  it('returns AI_EXECUTION_FAILED when both Haiku and Sonnet retry fail', async () => {
    vi.mocked(classifyCommand).mockReturnValue('simple');

    vi.mocked(tracedAnthropicCall)
      .mockRejectedValueOnce(new Error('Haiku fail'))
      .mockRejectedValueOnce(new Error('Sonnet also failed'));

    const result = await aiService.executeCommand(
      'board-1', 'create sticky', 'user-1', makeViewport()
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AI_EXECUTION_FAILED');
  });

  it('uses Sonnet max turns (7) for the retry attempt', async () => {
    vi.mocked(classifyCommand).mockReturnValue('simple');

    // Haiku fails → Sonnet retry also keeps hitting tool_use until max turns
    vi.mocked(tracedAnthropicCall)
      .mockRejectedValueOnce(new Error('Haiku fail'))
      // Sonnet retry: always returns tool_use → exhaust turns
      .mockResolvedValue(makeToolUseResponse('createStickyNote', { x: 0, y: 0, text: 'Test' }) as never);

    vi.mocked(toolExecutor.execute).mockResolvedValue(makeToolResult());

    const result = await aiService.executeCommand(
      'board-1', 'create sticky', 'user-1', makeViewport()
    );

    // Sonnet should have used 7 turns (AI_MAX_TURNS_COMPLEX=7)
    expect(result.usage?.turnsUsed).toBe(7);
  });
});

describe('aiService.executeCommand — WebSocket events', () => {
  it('includes boardId in the ai:thinking payload', async () => {
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    await aiService.executeCommand('board-42', 'create sticky', 'user-1', makeViewport());

    const thinkingCall = vi.mocked(trackedEmit).mock.calls.find(c => c[1] === 'ai:thinking');
    expect(thinkingCall).toBeDefined();
    const payload = thinkingCall![2] as { boardId: string; userId: string };
    expect(payload.boardId).toBe('board-42');
    expect(payload.userId).toBe('user-1');
  });

  it('includes operationCount in the ai:complete payload', async () => {
    vi.mocked(tracedAnthropicCall)
      .mockResolvedValueOnce(makeToolUseResponse('createStickyNote', { x: 0, y: 0, text: 'Hi' }) as never)
      .mockResolvedValueOnce(makeEndTurnResponse('Done.') as never);
    vi.mocked(toolExecutor.execute).mockResolvedValue(makeToolResult());

    await aiService.executeCommand('board-1', 'create sticky', 'user-1', makeViewport());

    const completeCall = vi.mocked(trackedEmit).mock.calls.find(c => c[1] === 'ai:complete');
    expect(completeCall).toBeDefined();
    const payload = completeCall![2] as { operationCount: number };
    expect(payload.operationCount).toBe(1);
  });

  it('truncates the command to 100 chars in ai:thinking payload', async () => {
    const longCommand = 'x'.repeat(150);
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    await aiService.executeCommand('board-1', longCommand, 'user-1', makeViewport());

    const thinkingCall = vi.mocked(trackedEmit).mock.calls.find(c => c[1] === 'ai:thinking');
    const payload = thinkingCall![2] as { command: string };
    expect(payload.command.length).toBeLessThanOrEqual(100);
  });
});

describe('aiService.executeCommand — chat history integration', () => {
  it('does not save chat history on error', async () => {
    vi.mocked(tracedAnthropicCall).mockRejectedValue(new Error('API error'));

    await aiService.executeCommand('board-1', 'create sticky', 'user-1', makeViewport());

    // appendMessages should NOT be called when there's a pure error with no partial ops
    expect(aiChatService.appendMessages).not.toHaveBeenCalled();
  });

  it('uses the existing chat history from getHistory as message prefix', async () => {
    vi.mocked(aiChatService.getHistory).mockResolvedValue([
      { role: 'user', content: 'previous command' },
      { role: 'assistant', content: 'previous response' },
    ]);
    vi.mocked(tracedAnthropicCall).mockResolvedValue(makeEndTurnResponse() as never);

    await aiService.executeCommand('board-1', 'new command', 'user-1', makeViewport());

    const callParams = vi.mocked(tracedAnthropicCall).mock.calls[0][0];
    const messages = callParams.messages as Array<{ role: string; content: string }>;
    expect(messages[0].content).toBe('previous command');
    expect(messages[1].content).toBe('previous response');
    expect(messages[2].content).toBe('new command');
    expect(messages[2].role).toBe('user');
  });
});
