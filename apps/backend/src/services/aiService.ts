import Anthropic from '@anthropic-ai/sdk';
import {
  WebSocketEvent,
  SONNET_MODEL_ID,
  HAIKU_MODEL_ID,
  AI_CONFIG,
  type ViewportBounds,
  type AICommandResponse,
  type AIOperation,
  type AIErrorCode,
  type AIThinkingPayload,
  type AICompletePayload,
} from 'shared';
import { buildSystemPrompt } from '../ai/systemPrompt';
import { AI_TOOLS } from '../ai/tools';
import { toolExecutor } from '../ai/toolExecutor';
import { classifyCommand } from '../ai/commandClassifier';
import { tracedAnthropicCall, tracedToolExecution, tracedCommandExecution, getCurrentTraceId } from '../ai/tracing';
import { aiBudgetService, calculateCostCents } from './aiBudgetService';
import { aiChatService } from './aiChatService';
import { auditService, AuditAction } from './auditService';
import { metricsService } from './metricsService';
import { getIO } from '../websocket/server';
import { trackedEmit } from '../websocket/wsMetrics';
import { logger } from '../utils/logger';

// ============================================================
// AI Service — Core Agent Loop
// ============================================================

/** Build an error response without calling Anthropic. */
function errorResponse(
  code: AIErrorCode,
  message: string,
  conversationId = ''
): AICommandResponse {
  return {
    success: false,
    conversationId,
    message,
    operations: [],
    error: { code, message },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostCents: 0,
      budgetRemainingCents: 0,
      turnsUsed: 0,
    },
    rateLimitRemaining: 0,
  };
}

// ────────────────────────────────────────────────────────────
// Agent Loop — extracted so we can retry with a different model
// ────────────────────────────────────────────────────────────

interface AgentLoopResult {
  finalMessage: string;
  operations: AIOperation[];
  inputTokens: number;
  outputTokens: number;
  turnsUsed: number;
  /** True if the loop ended with tool errors and zero successful operations. */
  failedWithNoOps: boolean;
  /** Error message if the loop threw. */
  error?: string;
}

async function runAgentLoop(
  model: string,
  messages: Anthropic.MessageParam[],
  maxTurns: number,
  boardId: string,
  userId: string,
  viewport: ViewportBounds,
): Promise<AgentLoopResult> {
  const operations: AIOperation[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let turn = 0;
  let creationCount = 0;
  let finalMessage = '';
  let toolErrorCount = 0;

  try {
    while (turn < maxTurns) {
      turn++;

      // Call Anthropic with LangSmith tracing
      const response = await tracedAnthropicCall({
        model,
        max_tokens: 4096,
        system: buildSystemPrompt(boardId, viewport),
        tools: AI_TOOLS,
        messages,
      });

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // Check stop reason
      if (response.stop_reason === 'end_turn') {
        finalMessage = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map(block => block.text)
          .join('');
        break;
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolCall of toolUseBlocks) {
          // Hard cap: stop executing tools if we've hit the operation limit
          if (operations.length >= AI_CONFIG.MAX_OPERATIONS_PER_COMMAND) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: `Operation limit reached (${AI_CONFIG.MAX_OPERATIONS_PER_COMMAND}). Stop and summarize what was completed.`,
              }),
            });
            continue;
          }

          // Hard cap: stop creating objects if we've hit the creation limit
          const isCreationTool = toolCall.name.startsWith('create');
          if (isCreationTool && creationCount >= AI_CONFIG.MAX_CREATIONS_PER_COMMAND) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: `Creation limit reached (${AI_CONFIG.MAX_CREATIONS_PER_COMMAND} objects). Stop creating and summarize what was completed.`,
              }),
            });
            continue;
          }

          // Execute tool with LangSmith tracing
          const result = await tracedToolExecution(
            toolCall.name,
            toolCall.input,
            boardId,
            userId,
            viewport,
            toolExecutor.execute.bind(toolExecutor)
          );

          const typedResult = result as { output: Record<string, unknown>; operation: AIOperation };
          operations.push(typedResult.operation);
          if (isCreationTool) creationCount++;

          // Track tool errors for retry decision
          if (typedResult.output && (typedResult.output as Record<string, unknown>).success === false) {
            toolErrorCount++;
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: JSON.stringify(typedResult.output),
          });
        }

        // Append assistant response + tool results for next turn
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
      }
    }

    // If we exhausted turns without end_turn, extract any text from the last response
    if (!finalMessage && turn >= maxTurns) {
      finalMessage = 'Completed (reached maximum steps).';
    }

    return {
      finalMessage,
      operations,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      turnsUsed: turn,
      failedWithNoOps: operations.length === 0 && toolErrorCount > 0,
    };
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : 'Unknown error';
    return {
      finalMessage: '',
      operations,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      turnsUsed: turn,
      failedWithNoOps: operations.length === 0,
      error: errMessage,
    };
  }
}

export const aiService = {
  /**
   * Execute an AI command on a board.
   * This is the main agent loop: budget check → build messages → call Anthropic
   * → execute tools → loop until end_turn or max turns → return summary.
   *
   * Model routing: simple commands → Haiku (5 turns), complex → Sonnet (7 turns).
   * If Haiku fails with zero successful operations, the command is retried with
   * Sonnet from a clean context (safety-net retry, not mid-loop escalation).
   */
  async executeCommand(
    boardId: string,
    command: string,
    userId: string,
    viewport: ViewportBounds
  ): Promise<AICommandResponse> {
    const startTime = Date.now();

    // Model routing: classify command complexity and pick model
    const complexity = classifyCommand(command);
    const sonnetModel = process.env.ANTHROPIC_MODEL_COMPLEX || process.env.ANTHROPIC_MODEL || SONNET_MODEL_ID;
    const haikuModel = process.env.ANTHROPIC_MODEL_SIMPLE || HAIKU_MODEL_ID;
    const initialModel = complexity === 'simple' ? haikuModel : sonnetModel;

    // Per-model turn limits: Haiku gets 5, Sonnet gets 7 (env-overridable)
    const haikuMaxTurns = parseInt(process.env.AI_MAX_TURNS_SIMPLE || '', 10) || AI_CONFIG.MAX_TURNS_SIMPLE;
    const sonnetMaxTurns = parseInt(process.env.AI_MAX_TURNS_COMPLEX || '', 10) || AI_CONFIG.MAX_TURNS_COMPLEX;
    const maxTurns = initialModel === haikuModel ? haikuMaxTurns : sonnetMaxTurns;

    logger.info(`AI classifier: "${command.slice(0, 80)}" → ${complexity} → ${initialModel === haikuModel ? 'Haiku' : 'Sonnet'} (maxTurns=${maxTurns})`);

    // 1. Budget check
    const budget = await aiBudgetService.checkBudget();
    if (!budget.hasRemaining) {
      return errorResponse(
        'AI_BUDGET_EXCEEDED',
        "Sorry, I can't process your request — the AI usage limit has been reached for this month."
      );
    }

    // 2. Load per-user chat history
    const chatHistory = await aiChatService.getHistory(boardId, userId);
    const conversationId = await aiChatService.getOrCreateConversationId(boardId, userId);

    // Wrap the entire agent loop in a top-level LangSmith trace.
    // The first argument becomes the trace's Input in the LangSmith UI.
    return tracedCommandExecution(
      { command, boardId, userId, model: initialModel },
      async () => {

    // 3. Build messages array
    const buildMessages = (): Anthropic.MessageParam[] => [
      ...chatHistory.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user' as const, content: command },
    ];

    // 4. Broadcast ai:thinking to all board users
    const thinkingPayload: AIThinkingPayload = {
      boardId,
      userId,
      command: command.slice(0, 100),
      timestamp: Date.now(),
    };
    try {
      trackedEmit(getIO().to(boardId), WebSocketEvent.AI_THINKING, thinkingPayload);
    } catch {
      // Socket.io may not be ready (e.g., during tests) — non-fatal
    }

    // 5. Run agent loop
    let result = await runAgentLoop(
      initialModel, buildMessages(), maxTurns, boardId, userId, viewport
    );
    let finalModel = initialModel;
    let retried = false;

    // Track per-model tokens for metrics
    let haikuInputTokens = initialModel === haikuModel ? result.inputTokens : 0;
    let haikuOutputTokens = initialModel === haikuModel ? result.outputTokens : 0;
    let sonnetInputTokens = initialModel === sonnetModel ? result.inputTokens : 0;
    let sonnetOutputTokens = initialModel === sonnetModel ? result.outputTokens : 0;

    // 5b. Safety-net retry: if Haiku failed with zero successful operations,
    //     retry the entire command with Sonnet from a clean context.
    if (initialModel === haikuModel && result.failedWithNoOps) {
      logger.warn(
        `AI Haiku failed with 0 ops — retrying with Sonnet (command: "${command.slice(0, 60)}", ` +
        `error: ${result.error || 'tool errors'}, turns: ${result.turnsUsed})`
      );

      // Record the failed Haiku attempt in metrics before retrying
      const haikuCost = calculateCostCents(haikuInputTokens, haikuOutputTokens, haikuModel);
      metricsService.recordAICommand({
        latencyMs: Date.now() - startTime,
        costCents: haikuCost,
        inputTokens: haikuInputTokens,
        outputTokens: haikuOutputTokens,
        success: false,
        errorCode: 'AI_HAIKU_RETRY',
        model: haikuModel,
      });

      // Retry with Sonnet — fresh messages, full turn budget
      result = await runAgentLoop(
        sonnetModel, buildMessages(), sonnetMaxTurns, boardId, userId, viewport
      );
      finalModel = sonnetModel;
      retried = true;

      // Add Sonnet tokens
      sonnetInputTokens += result.inputTokens;
      sonnetOutputTokens += result.outputTokens;

      logger.info(
        `AI Sonnet retry ${result.error ? 'also failed' : 'succeeded'}: ` +
        `${result.operations.length} ops, ${result.turnsUsed} turns`
      );
    }

    // Aggregate totals
    const totalInputTokens = haikuInputTokens + sonnetInputTokens;
    const totalOutputTokens = haikuOutputTokens + sonnetOutputTokens;
    const totalTurnsUsed = result.turnsUsed; // Report turns of the final (successful) attempt

    // Handle errors (either from initial run or retry)
    if (result.error) {
      const costCents = calculateCostCents(haikuInputTokens, haikuOutputTokens, haikuModel)
                      + calculateCostCents(sonnetInputTokens, sonnetOutputTokens, sonnetModel);
      await aiBudgetService.recordUsage(userId, costCents, {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        command,
        boardId,
        turnsUsed: totalTurnsUsed,
        toolCallCount: result.operations.length,
      });

      metricsService.recordAICommand({
        latencyMs: Date.now() - startTime,
        costCents,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        success: false,
        errorCode: 'AI_EXECUTION_FAILED',
        model: finalModel,
        ...(retried ? {
          modelSplits: [
            { model: haikuModel, inputTokens: haikuInputTokens, outputTokens: haikuOutputTokens, costCents: calculateCostCents(haikuInputTokens, haikuOutputTokens, haikuModel) },
            { model: sonnetModel, inputTokens: sonnetInputTokens, outputTokens: sonnetOutputTokens, costCents: calculateCostCents(sonnetInputTokens, sonnetOutputTokens, sonnetModel) },
          ],
        } : {}),
      });

      auditService.log({
        userId,
        action: AuditAction.AI_EXECUTE,
        entityType: 'board',
        entityId: boardId,
        metadata: {
          command,
          operationCount: result.operations.length,
          costCents,
          turnsUsed: totalTurnsUsed,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          model: finalModel,
          complexity,
          retried,
          traceId: getCurrentTraceId(),
          success: false,
          errorCode: 'AI_EXECUTION_FAILED',
          errorMessage: result.error,
        },
      });

      // Broadcast ai:complete
      try {
        const completePayload: AICompletePayload = {
          boardId,
          userId,
          operationCount: result.operations.length,
          timestamp: Date.now(),
        };
        trackedEmit(getIO().to(boardId), WebSocketEvent.AI_COMPLETE, completePayload);
      } catch {
        // non-fatal
      }

      // If we managed some operations, return partial success
      if (result.operations.length > 0) {
        return {
          success: true,
          conversationId,
          message: `Partially completed (${result.operations.length} operations) before error: ${result.error}`,
          operations: result.operations,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens,
            estimatedCostCents: costCents,
            budgetRemainingCents: Math.max(0, budget.remainingCents - costCents),
            turnsUsed: totalTurnsUsed,
          },
          rateLimitRemaining: 0,
        };
      }

      return errorResponse('AI_EXECUTION_FAILED', result.error, conversationId);
    }

    // 6. Record usage & cost
    const costCents = calculateCostCents(haikuInputTokens, haikuOutputTokens, haikuModel)
                    + calculateCostCents(sonnetInputTokens, sonnetOutputTokens, sonnetModel);
    await aiBudgetService.recordUsage(userId, costCents, {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      command,
      boardId,
      turnsUsed: totalTurnsUsed,
      toolCallCount: result.operations.length,
    });

    // 7. Save to per-user chat history
    await aiChatService.appendMessages(boardId, userId, [
      { role: 'user', content: command },
      { role: 'assistant', content: result.finalMessage },
    ]);

    // 8. Audit log
    auditService.log({
      userId,
      action: AuditAction.AI_EXECUTE,
      entityType: 'board',
      entityId: boardId,
      metadata: {
        command,
        operationCount: result.operations.length,
        costCents,
        turnsUsed: totalTurnsUsed,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        model: finalModel,
        complexity,
        retried,
        traceId: getCurrentTraceId(),
        success: true,
      },
    });

    // 9. Record metrics
    metricsService.recordAICommand({
      latencyMs: Date.now() - startTime,
      costCents,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      success: true,
      model: finalModel,
      ...(retried ? {
        modelSplits: [
          { model: haikuModel, inputTokens: haikuInputTokens, outputTokens: haikuOutputTokens, costCents: calculateCostCents(haikuInputTokens, haikuOutputTokens, haikuModel) },
          { model: sonnetModel, inputTokens: sonnetInputTokens, outputTokens: sonnetOutputTokens, costCents: calculateCostCents(sonnetInputTokens, sonnetOutputTokens, sonnetModel) },
        ],
      } : {}),
    });

    // 10. Broadcast ai:complete
    try {
      const completePayload: AICompletePayload = {
        boardId,
        userId,
        operationCount: result.operations.length,
        timestamp: Date.now(),
      };
      trackedEmit(getIO().to(boardId), WebSocketEvent.AI_COMPLETE, completePayload);
    } catch {
      // non-fatal
    }

    // 11. Return response
    const updatedBudget = await aiBudgetService.checkBudget();

    return {
      success: true,
      conversationId,
      message: result.finalMessage,
      operations: result.operations,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        estimatedCostCents: costCents,
        budgetRemainingCents: updatedBudget.remainingCents,
        turnsUsed: totalTurnsUsed,
      },
      rateLimitRemaining: 0, // Will be set by controller from rate limit headers
    };

      } // end tracedCommandExecution callback
    ); // end tracedCommandExecution
  },
};
