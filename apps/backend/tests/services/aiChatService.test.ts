import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/utils/redisScan', () => ({
  scanKeys: vi.fn(),
}));

import { instrumentedRedis as redis } from '../../src/utils/instrumentedRedis';
import { scanKeys } from '../../src/utils/redisScan';
import { logger } from '../../src/utils/logger';

// Import service AFTER mocks are set up via setup.ts
import { aiChatService } from '../../src/services/aiChatService';

// ─── Key helpers (mirrors the private helpers in aiChatService) ───────────────
function messagesKey(boardId: string, userId: string): string {
  return `ai:chat:${boardId}:${userId}:messages`;
}

function convIdKey(boardId: string, userId: string): string {
  return `ai:chat:${boardId}:${userId}:convId`;
}

// ============================================================
// getOrCreateConversationId
// ============================================================

describe('aiChatService.getOrCreateConversationId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the existing conversation ID when one is stored in Redis', async () => {
    const existingId = 'conv-existing-uuid';
    vi.mocked(redis.get).mockResolvedValue(existingId);
    vi.mocked(redis.expire).mockResolvedValue(1);

    const result = await aiChatService.getOrCreateConversationId('board-1', 'user-1');

    expect(result).toBe(existingId);
    expect(redis.get).toHaveBeenCalledWith(convIdKey('board-1', 'user-1'));
  });

  it('refreshes the TTL when an existing conversation ID is found', async () => {
    vi.mocked(redis.get).mockResolvedValue('conv-existing-uuid');
    vi.mocked(redis.expire).mockResolvedValue(1);

    await aiChatService.getOrCreateConversationId('board-1', 'user-1');

    expect(redis.expire).toHaveBeenCalledWith(
      convIdKey('board-1', 'user-1'),
      expect.any(Number)
    );
  });

  it('creates and stores a new conversation ID when none exists in Redis', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.setex).mockResolvedValue('OK');

    const result = await aiChatService.getOrCreateConversationId('board-2', 'user-2');

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(redis.setex).toHaveBeenCalledWith(
      convIdKey('board-2', 'user-2'),
      expect.any(Number),
      result
    );
  });

  it('stores the new conversation ID with a positive TTL', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.setex).mockResolvedValue('OK');

    await aiChatService.getOrCreateConversationId('board-1', 'user-1');

    const [, ttl] = vi.mocked(redis.setex).mock.calls[0];
    expect(ttl).toBeGreaterThan(0);
  });

  it('returns a fallback UUID (without throwing) when Redis fails', async () => {
    vi.mocked(redis.get).mockRejectedValue(new Error('Redis connection refused'));

    const result = await aiChatService.getOrCreateConversationId('board-1', 'user-1');

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns different IDs for different board+user pairs', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.setex).mockResolvedValue('OK');

    const id1 = await aiChatService.getOrCreateConversationId('board-A', 'user-1');
    const id2 = await aiChatService.getOrCreateConversationId('board-B', 'user-1');

    // Each UUID generated is random — they should differ
    expect(id1).not.toBe(id2);
  });
});

// ============================================================
// getHistory
// ============================================================

describe('aiChatService.getHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty array when no history exists in Redis', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    const result = await aiChatService.getHistory('board-1', 'user-1');

    expect(result).toEqual([]);
    expect(redis.get).toHaveBeenCalledWith(messagesKey('board-1', 'user-1'));
  });

  it('parses and returns the stored message array from Redis', async () => {
    const messages = [
      { role: 'user' as const, content: 'Create a sticky note' },
      { role: 'assistant' as const, content: 'Done — I created a sticky note.' },
    ];
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(messages));

    const result = await aiChatService.getHistory('board-1', 'user-1');

    expect(result).toEqual(messages);
  });

  it('uses the correct Redis key format (ai:chat:{boardId}:{userId}:messages)', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    await aiChatService.getHistory('board-X', 'user-Y');

    expect(redis.get).toHaveBeenCalledWith('ai:chat:board-X:user-Y:messages');
  });

  it('returns empty array and logs a warning when Redis returns invalid JSON', async () => {
    vi.mocked(redis.get).mockResolvedValue('not-valid-json{{{');

    const result = await aiChatService.getHistory('board-1', 'user-1');

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns empty array and logs a warning when Redis throws', async () => {
    vi.mocked(redis.get).mockRejectedValue(new Error('Redis error'));

    const result = await aiChatService.getHistory('board-1', 'user-1');

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ============================================================
// appendMessages
// ============================================================

describe('aiChatService.appendMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends new messages to an empty history and saves back', async () => {
    vi.mocked(redis.get).mockResolvedValue(null); // empty history
    vi.mocked(redis.setex).mockResolvedValue('OK');

    const newMessages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ];
    await aiChatService.appendMessages('board-1', 'user-1', newMessages);

    expect(redis.setex).toHaveBeenCalledWith(
      messagesKey('board-1', 'user-1'),
      expect.any(Number),
      expect.stringContaining('"Hello"')
    );
  });

  it('appends messages to existing history', async () => {
    const existing = [{ role: 'user' as const, content: 'First message' }];
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(existing));
    vi.mocked(redis.setex).mockResolvedValue('OK');

    const newMessages = [{ role: 'assistant' as const, content: 'Response' }];
    await aiChatService.appendMessages('board-1', 'user-1', newMessages);

    const [, , savedJson] = vi.mocked(redis.setex).mock.calls[0];
    const saved = JSON.parse(savedJson as string);
    expect(saved).toHaveLength(2);
    expect(saved[0].content).toBe('First message');
    expect(saved[1].content).toBe('Response');
  });

  it('trims to the sliding window when history exceeds max messages', async () => {
    // Default AI_CONFIG.CHAT_MAX_MESSAGES = 10; override for test
    const originalEnv = process.env.AI_CHAT_MAX_MESSAGES;
    process.env.AI_CHAT_MAX_MESSAGES = '4';

    try {
      // Build existing history with 4 messages (at capacity)
      const existing = Array.from({ length: 4 }, (_, i) => ({
        role: 'user' as const,
        content: `Old message ${i}`,
      }));
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(existing));
      vi.mocked(redis.setex).mockResolvedValue('OK');

      const newMessages = [
        { role: 'assistant' as const, content: 'New message A' },
        { role: 'user' as const, content: 'New message B' },
      ];
      await aiChatService.appendMessages('board-1', 'user-1', newMessages);

      const [, , savedJson] = vi.mocked(redis.setex).mock.calls[0];
      const saved = JSON.parse(savedJson as string);

      // Should be trimmed to last 4 (the window)
      expect(saved).toHaveLength(4);
      // The most recent messages should be at the end
      expect(saved[saved.length - 1].content).toBe('New message B');
      expect(saved[saved.length - 2].content).toBe('New message A');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.AI_CHAT_MAX_MESSAGES;
      } else {
        process.env.AI_CHAT_MAX_MESSAGES = originalEnv;
      }
    }
  });

  it('saves with a positive TTL', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.setex).mockResolvedValue('OK');

    await aiChatService.appendMessages('board-1', 'user-1', [
      { role: 'user' as const, content: 'test' },
    ]);

    const [, ttl] = vi.mocked(redis.setex).mock.calls[0];
    expect(ttl).toBeGreaterThan(0);
  });

  it('logs an error but does not throw when Redis write fails', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.setex).mockRejectedValue(new Error('Write failed'));

    await expect(
      aiChatService.appendMessages('board-1', 'user-1', [
        { role: 'user' as const, content: 'test' },
      ])
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });

  it('keeps oldest messages when trimming exceeds max window', async () => {
    const originalEnv = process.env.AI_CHAT_MAX_MESSAGES;
    process.env.AI_CHAT_MAX_MESSAGES = '3';

    try {
      const existing = [
        { role: 'user' as const, content: 'msg-0' },
        { role: 'assistant' as const, content: 'msg-1' },
        { role: 'user' as const, content: 'msg-2' },
      ];
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(existing));
      vi.mocked(redis.setex).mockResolvedValue('OK');

      await aiChatService.appendMessages('board-1', 'user-1', [
        { role: 'assistant' as const, content: 'msg-3' },
      ]);

      const [, , savedJson] = vi.mocked(redis.setex).mock.calls[0];
      const saved = JSON.parse(savedJson as string);
      expect(saved).toHaveLength(3);
      // msg-0 (oldest) should be dropped
      expect(saved.map((m: { content: string }) => m.content)).not.toContain('msg-0');
      expect(saved.map((m: { content: string }) => m.content)).toContain('msg-3');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.AI_CHAT_MAX_MESSAGES;
      } else {
        process.env.AI_CHAT_MAX_MESSAGES = originalEnv;
      }
    }
  });
});

// ============================================================
// purgeChat
// ============================================================

describe('aiChatService.purgeChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes both the messages key and the convId key for the user+board', async () => {
    vi.mocked(redis.del).mockResolvedValue(1);

    await aiChatService.purgeChat('board-1', 'user-1');

    expect(redis.del).toHaveBeenCalledWith(messagesKey('board-1', 'user-1'));
    expect(redis.del).toHaveBeenCalledWith(convIdKey('board-1', 'user-1'));
  });

  it('calls del exactly twice (one per key)', async () => {
    vi.mocked(redis.del).mockResolvedValue(1);

    await aiChatService.purgeChat('board-1', 'user-1');

    expect(redis.del).toHaveBeenCalledTimes(2);
  });

  it('logs at debug level on success', async () => {
    vi.mocked(redis.del).mockResolvedValue(1);

    await aiChatService.purgeChat('board-1', 'user-1');

    expect(logger.debug).toHaveBeenCalled();
  });

  it('logs an error but does not throw when Redis del fails', async () => {
    vi.mocked(redis.del).mockRejectedValue(new Error('Connection lost'));

    await expect(aiChatService.purgeChat('board-1', 'user-1')).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });

  it('uses the correct key format for both keys', async () => {
    vi.mocked(redis.del).mockResolvedValue(1);

    await aiChatService.purgeChat('board-XYZ', 'user-ABC');

    expect(redis.del).toHaveBeenCalledWith('ai:chat:board-XYZ:user-ABC:messages');
    expect(redis.del).toHaveBeenCalledWith('ai:chat:board-XYZ:user-ABC:convId');
  });
});

// ============================================================
// purgeBoardChats
// ============================================================

describe('aiChatService.purgeBoardChats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scans for all keys matching ai:chat:{boardId}:* and deletes them', async () => {
    const keys = [
      'ai:chat:board-1:user-A:messages',
      'ai:chat:board-1:user-A:convId',
      'ai:chat:board-1:user-B:messages',
    ];
    vi.mocked(scanKeys).mockResolvedValue(keys);
    vi.mocked(redis.del).mockResolvedValue(3);

    await aiChatService.purgeBoardChats('board-1');

    expect(scanKeys).toHaveBeenCalledWith('ai:chat:board-1:*');
    expect(redis.del).toHaveBeenCalledWith(...keys);
  });

  it('skips the del call when no keys are found', async () => {
    vi.mocked(scanKeys).mockResolvedValue([]);

    await aiChatService.purgeBoardChats('board-1');

    expect(redis.del).not.toHaveBeenCalled();
  });

  it('logs at debug level and reports key count when keys are found', async () => {
    const keys = ['ai:chat:board-1:user-A:messages', 'ai:chat:board-1:user-A:convId'];
    vi.mocked(scanKeys).mockResolvedValue(keys);
    vi.mocked(redis.del).mockResolvedValue(2);

    await aiChatService.purgeBoardChats('board-1');

    expect(logger.debug).toHaveBeenCalled();
  });

  it('logs an error but does not throw when Redis.keys fails', async () => {
    vi.mocked(scanKeys).mockRejectedValue(new Error('SCAN failed'));

    await expect(aiChatService.purgeBoardChats('board-1')).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });

  it('passes the correct board-scoped pattern to keys', async () => {
    vi.mocked(scanKeys).mockResolvedValue([]);

    await aiChatService.purgeBoardChats('board-unique-42');

    expect(scanKeys).toHaveBeenCalledWith('ai:chat:board-unique-42:*');
  });
});
