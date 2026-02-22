import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeReq, makeRes, makeNext } from '../mocks/factories';
import { AppError } from '../../src/middleware/errorHandler';

// ─── Mock aiService ───────────────────────────────────────────────────────────
vi.mock('../../src/services/aiService', () => ({
  aiService: {
    executeCommand: vi.fn(),
  },
}));

// ─── Mock aiBudgetService ─────────────────────────────────────────────────────
vi.mock('../../src/services/aiBudgetService', () => ({
  aiBudgetService: {
    getMonthlyUsage: vi.fn(),
  },
  calculateCostCents: vi.fn(),
}));

// ─── Mock wsMetrics ───────────────────────────────────────────────────────────
vi.mock('../../src/websocket/wsMetrics', () => ({
  trackedEmit: vi.fn(),
}));

import { aiController } from '../../src/controllers/aiController';
import { aiService } from '../../src/services/aiService';
import { aiBudgetService } from '../../src/services/aiBudgetService';

// Helper: build a valid viewport body
function makeViewport() {
  return { x: 0, y: 0, width: 1920, height: 1080, zoom: 1 };
}

// Helper: build a successful AI command result
function makeAIResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    conversationId: 'conv-1',
    message: 'Created 1 sticky note.',
    operations: [{ type: 'create', objectId: 'obj-1' }],
    error: null,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      estimatedCostCents: 1,
      budgetRemainingCents: 999,
      turnsUsed: 2,
    },
    rateLimitRemaining: 0,
    ...overrides,
  };
}

describe('aiController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: AI enabled
    process.env.AI_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
  });

  // ─── executeCommand ──────────────────────────────────────────────────────────
  describe('executeCommand', () => {
    it('returns 503 when AI_ENABLED is not "true"', async () => {
      process.env.AI_ENABLED = 'false';

      const req = makeReq({
        body: {
          boardId: 'board-1',
          command: 'add a sticky note',
          viewport: makeViewport(),
        },
      });
      const res = makeRes();
      const next = makeNext();

      await aiController.executeCommand(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'AI_DISABLED' }),
        })
      );
      expect(aiService.executeCommand).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('calls aiService.executeCommand with correct args and returns result', async () => {
      const aiResult = makeAIResult();
      vi.mocked(aiService.executeCommand).mockResolvedValue(aiResult as never);

      const req = makeReq({
        body: {
          boardId: 'board-1',
          command: 'add a sticky note',
          viewport: makeViewport(),
        },
      });
      // makeRes() doesn't include getHeader — add it so the controller doesn't throw
      const res = Object.assign(makeRes(), { getHeader: vi.fn().mockReturnValue('0') });
      const next = makeNext();

      await aiController.executeCommand(req, res, next);

      expect(aiService.executeCommand).toHaveBeenCalledWith(
        'board-1',
        'add a sticky note',
        'auth0|user-1',
        makeViewport()
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Created 1 sticky note.' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('attaches rateLimitRemaining from X-RateLimit-Remaining header', async () => {
      const aiResult = makeAIResult({ rateLimitRemaining: 0 });
      vi.mocked(aiService.executeCommand).mockResolvedValue(aiResult as never);

      const req = makeReq({
        body: { boardId: 'board-1', command: 'add a sticky', viewport: makeViewport() },
      });
      // Provide getHeader so the controller can read the rate-limit header
      const res = Object.assign(makeRes(), { getHeader: vi.fn().mockReturnValue('7') });
      const next = makeNext();

      await aiController.executeCommand(req, res, next);

      const jsonArg = vi.mocked(res.json).mock.calls[0][0] as { rateLimitRemaining: number };
      expect(jsonArg.rateLimitRemaining).toBe(7);
    });

    it('calls next with error when aiService.executeCommand throws', async () => {
      const error = new AppError(500, 'Internal error');
      vi.mocked(aiService.executeCommand).mockRejectedValue(error);

      const req = makeReq({
        body: { boardId: 'board-1', command: 'add a sticky', viewport: makeViewport() },
      });
      const res = makeRes();
      const next = makeNext();

      await aiController.executeCommand(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('calls next when user is missing from request', async () => {
      const req = makeReq({
        user: undefined,
        body: { boardId: 'board-1', command: 'add a sticky', viewport: makeViewport() },
      });
      const res = makeRes();
      const next = makeNext();

      await aiController.executeCommand(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('returns 503 when AI_ENABLED env var is missing entirely', async () => {
      delete process.env.AI_ENABLED;

      const req = makeReq({
        body: { boardId: 'board-1', command: 'add a sticky', viewport: makeViewport() },
      });
      const res = makeRes();
      const next = makeNext();

      await aiController.executeCommand(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
    });
  });

  // ─── getStatus ────────────────────────────────────────────────────────────────
  describe('getStatus', () => {
    it('returns enabled=false with reason when AI_ENABLED is not "true"', async () => {
      process.env.AI_ENABLED = 'false';

      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await aiController.getStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        enabled: false,
        reason: 'AI features are disabled by server configuration',
      });
      expect(aiBudgetService.getMonthlyUsage).not.toHaveBeenCalled();
    });

    it('returns enabled=false when ANTHROPIC_API_KEY is missing', async () => {
      process.env.AI_ENABLED = 'true';
      delete process.env.ANTHROPIC_API_KEY;

      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await aiController.getStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        enabled: false,
        reason: 'Anthropic API key not configured',
      });
      expect(aiBudgetService.getMonthlyUsage).not.toHaveBeenCalled();
    });

    it('returns full status with budget info when AI is enabled and configured', async () => {
      process.env.AI_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.RATE_LIMIT_AI_MAX_REQUESTS = '10';

      vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
        budgetCents: 5000,
        spentCents: 1200,
        calls: 42,
        tokens: 100000,
      } as never);

      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await aiController.getStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          budgetRemainingCents: 3800,
          budgetTotalCents: 5000,
          rateLimitPerMinute: 10,
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('budgetRemainingCents is floored at 0 when overspent', async () => {
      process.env.AI_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-test';

      vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
        budgetCents: 1000,
        spentCents: 2000,
        calls: 100,
        tokens: 500000,
      } as never);

      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await aiController.getStatus(req, res, next);

      const jsonArg = vi.mocked(res.json).mock.calls[0][0] as { budgetRemainingCents: number };
      expect(jsonArg.budgetRemainingCents).toBe(0);
    });

    it('calls next when aiBudgetService.getMonthlyUsage throws', async () => {
      process.env.AI_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-test';

      const error = new Error('Redis unavailable');
      vi.mocked(aiBudgetService.getMonthlyUsage).mockRejectedValue(error);

      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await aiController.getStatus(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('uses default rateLimitPerMinute of 10 when env var is absent', async () => {
      process.env.AI_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      delete process.env.RATE_LIMIT_AI_MAX_REQUESTS;

      vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
        budgetCents: 5000,
        spentCents: 0,
        calls: 0,
        tokens: 0,
      } as never);

      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await aiController.getStatus(req, res, next);

      const jsonArg = vi.mocked(res.json).mock.calls[0][0] as { rateLimitPerMinute: number };
      expect(jsonArg.rateLimitPerMinute).toBe(10);
    });
  });
});
