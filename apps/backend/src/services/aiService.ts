import Anthropic from '@anthropic-ai/sdk';
import {
  WebSocketEvent,
  SONNET_MODEL_ID,
  HAIKU_MODEL_ID,
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
import { tracedAnthropicCall, tracedToolExecution, getCurrentTraceId } from '../ai/tracing';
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

export const aiService = {
  /**
   * Execute an AI command on a board.
   * This is the main agent loop: budget check → build messages → call Anthropic
   * → execute tools → loop until end_turn or max turns → return summary.
   */
  async executeCommand(
    boardId: string,
    command: string,
    userId: string,
    viewport: ViewportBounds
  ): Promise<AICommandResponse> {
    const startTime = Date.now();
    const maxTurns = parseInt(process.env.AI_MAX_TURNS || '', 10) || 3;

    // Model routing: classify command complexity and pick model
    const complexity = classifyCommand(command);
    const sonnetModel = process.env.ANTHROPIC_MODEL_COMPLEX || process.env.ANTHROPIC_MODEL || SONNET_MODEL_ID;
    const haikuModel = process.env.ANTHROPIC_MODEL_SIMPLE || HAIKU_MODEL_ID;
    let model = complexity === 'simple' ? haikuModel : sonnetModel;
    let escalated = false;

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

    // 3. Build messages array
    const messages: Anthropic.MessageParam[] = [
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

    // 5. Agent loop
    const allOperations: AIOperation[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let turn = 0;
    let finalMessage = '';

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
          // Extract text content
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
            allOperations.push(typedResult.operation);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: JSON.stringify(typedResult.output),
            });
          }

          // Append assistant response + tool results for next turn
          messages.push({ role: 'assistant', content: response.content });
          messages.push({ role: 'user', content: toolResults });

          // Escalation: if Haiku needed multiple turns, switch to Sonnet
          // for remaining turns (better multi-step reasoning)
          if (!escalated && model === haikuModel && turn < maxTurns) {
            model = sonnetModel;
            escalated = true;
            logger.info(`AI model escalated from Haiku → Sonnet (turn ${turn}, command: "${command.slice(0, 60)}")`);
          }
        }
      }

      // If we exhausted turns without end_turn, extract any text from the last response
      if (!finalMessage && turn >= maxTurns) {
        finalMessage = 'Completed (reached maximum steps).';
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`AI agent loop error: ${errMessage}`);

      // Record partial usage (use current model for pricing — close enough for error path)
      const costCents = calculateCostCents(totalInputTokens, totalOutputTokens, model);
      await aiBudgetService.recordUsage(userId, costCents, {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        command,
        boardId,
        turnsUsed: turn,
        toolCallCount: allOperations.length,
      });

      // Record failure in metrics
      metricsService.recordAICommand({
        latencyMs: Date.now() - startTime,
        costCents,
        tokenCount: totalInputTokens + totalOutputTokens,
        success: false,
        errorCode: 'AI_EXECUTION_FAILED',
      });

      // Audit log
      auditService.log({
        userId,
        action: AuditAction.AI_EXECUTE,
        entityType: 'board',
        entityId: boardId,
        metadata: {
          command,
          operationCount: allOperations.length,
          costCents,
          turnsUsed: turn,
          success: false,
          errorCode: 'AI_EXECUTION_FAILED',
          errorMessage: errMessage,
        },
      });

      // Broadcast ai:complete
      try {
        const completePayload: AICompletePayload = {
          boardId,
          userId,
          operationCount: allOperations.length,
          timestamp: Date.now(),
        };
        trackedEmit(getIO().to(boardId), WebSocketEvent.AI_COMPLETE, completePayload);
      } catch {
        // non-fatal
      }

      // If we managed some operations, return partial success
      if (allOperations.length > 0) {
        return {
          success: true,
          conversationId,
          message: `Partially completed (${allOperations.length} operations) before error: ${errMessage}`,
          operations: allOperations,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens,
            estimatedCostCents: costCents,
            budgetRemainingCents: Math.max(0, budget.remainingCents - costCents),
            turnsUsed: turn,
          },
          rateLimitRemaining: 0,
        };
      }

      return errorResponse('AI_EXECUTION_FAILED', errMessage, conversationId);
    }

    // 6. Record usage & cost
    const costCents = calculateCostCents(totalInputTokens, totalOutputTokens, model);
    await aiBudgetService.recordUsage(userId, costCents, {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      command,
      boardId,
      turnsUsed: turn,
      toolCallCount: allOperations.length,
    });

    // 7. Save to per-user chat history
    await aiChatService.appendMessages(boardId, userId, [
      { role: 'user', content: command },
      { role: 'assistant', content: finalMessage },
    ]);

    // 8. Audit log
    auditService.log({
      userId,
      action: AuditAction.AI_EXECUTE,
      entityType: 'board',
      entityId: boardId,
      metadata: {
        command,
        operationCount: allOperations.length,
        costCents,
        turnsUsed: turn,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        model,
        complexity,
        escalated,
        traceId: getCurrentTraceId(),
        success: true,
      },
    });

    // 9. Record metrics
    metricsService.recordAICommand({
      latencyMs: Date.now() - startTime,
      costCents,
      tokenCount: totalInputTokens + totalOutputTokens,
      success: true,
    });

    // 10. Broadcast ai:complete
    try {
      const completePayload: AICompletePayload = {
        boardId,
        userId,
        operationCount: allOperations.length,
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
      message: finalMessage,
      operations: allOperations,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        estimatedCostCents: costCents,
        budgetRemainingCents: updatedBudget.remainingCents,
        turnsUsed: turn,
      },
      rateLimitRemaining: 0, // Will be set by controller from rate limit headers
    };
  },
};
