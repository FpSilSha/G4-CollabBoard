import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { aiService } from '../services/aiService';
import { aiBudgetService } from '../services/aiBudgetService';
import { logger } from '../utils/logger';

// ============================================================
// AI Controller — REST Endpoints
// ============================================================

export const aiController = {
  /**
   * POST /ai/execute
   * Execute an AI command on a board.
   */
  async executeCommand(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as AuthenticatedRequest).user.sub;

      const body = req.body as {
        boardId: string;
        command: string;
        conversationId?: string;
        viewport: { x: number; y: number; width: number; height: number; zoom: number };
      };

      // Guard: AI must be enabled
      if (process.env.AI_ENABLED !== 'true') {
        res.status(503).json({
          success: false,
          error: { code: 'AI_DISABLED', message: 'AI features are currently disabled' },
        });
        return;
      }

      const result = await aiService.executeCommand(
        body.boardId,
        body.command,
        userId,
        body.viewport
      );

      // Populate rate limit remaining from response headers (set by middleware)
      const rateLimitRemaining = parseInt(
        res.getHeader('X-RateLimit-Remaining') as string || '0', 10
      );
      result.rateLimitRemaining = rateLimitRemaining;

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /ai/status
   * Check AI availability, budget, and rate limits.
   */
  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const enabled = process.env.AI_ENABLED === 'true';

      if (!enabled) {
        res.json({
          enabled: false,
          reason: 'AI features are disabled by server configuration',
        });
        return;
      }

      // Check if Anthropic API key is configured
      if (!process.env.ANTHROPIC_API_KEY) {
        res.json({
          enabled: false,
          reason: 'Anthropic API key not configured',
        });
        return;
      }

      const usage = await aiBudgetService.getMonthlyUsage();

      res.json({
        enabled: true,
        models: {
          simple: process.env.ANTHROPIC_MODEL_SIMPLE || 'claude-3-5-haiku-20241022',
          complex: process.env.ANTHROPIC_MODEL_COMPLEX || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
        },
        budgetRemainingCents: Math.max(0, usage.budgetCents - usage.spentCents),
        budgetTotalCents: usage.budgetCents,
        rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_AI_MAX_REQUESTS || '10', 10),
      });
    } catch (err) {
      next(err);
    }
  },
};
