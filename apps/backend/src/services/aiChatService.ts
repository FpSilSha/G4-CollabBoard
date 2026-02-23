import { instrumentedRedis as redis } from '../utils/instrumentedRedis';
import { scanKeys } from '../utils/redisScan';
import { AI_CONFIG } from 'shared';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// AI Chat Service — Per-user chat history (Redis-backed)
// ============================================================

/**
 * Redis key helpers.
 * Each user on each board has independent chat history.
 */
function messagesKey(boardId: string, userId: string): string {
  return `ai:chat:${boardId}:${userId}:messages`;
}

function convIdKey(boardId: string, userId: string): string {
  return `ai:chat:${boardId}:${userId}:convId`;
}

/** Shape of messages stored in Redis (matches Anthropic message format). */
interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ============================================================
// Chat Service
// ============================================================

export const aiChatService = {
  /**
   * Get or create a conversation ID for this user+board pair.
   * The conversation ID is returned to the frontend for tracking.
   */
  async getOrCreateConversationId(boardId: string, userId: string): Promise<string> {
    const ttl = parseInt(process.env.AI_CHAT_HISTORY_TTL || '', 10)
      || AI_CONFIG.CHAT_HISTORY_TTL_SECONDS;

    try {
      const existing = await redis.get(convIdKey(boardId, userId));
      if (existing) {
        // Refresh TTL
        await redis.expire(convIdKey(boardId, userId), ttl);
        return existing;
      }

      const newId = uuidv4();
      await redis.setex(convIdKey(boardId, userId), ttl, newId);
      return newId;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.warn(`Chat convId error (generating fallback): ${message}`);
      return uuidv4();
    }
  },

  /**
   * Get chat history for this user+board pair.
   * Returns the last N messages (sliding window).
   * Format matches Anthropic MessageParam (role + content).
   */
  async getHistory(
    boardId: string,
    userId: string
  ): Promise<StoredMessage[]> {
    try {
      const raw = await redis.get(messagesKey(boardId, userId));
      if (!raw) return [];

      const messages: StoredMessage[] = JSON.parse(raw);
      return messages;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.warn(`Chat history read failed (returning empty): ${message}`);
      return [];
    }
  },

  /**
   * Append new messages to the chat history.
   * Maintains a sliding window of the last AI_CHAT_MAX_MESSAGES messages.
   * Refreshes TTL on every write.
   */
  async appendMessages(
    boardId: string,
    userId: string,
    newMessages: StoredMessage[]
  ): Promise<void> {
    const maxMessages = parseInt(process.env.AI_CHAT_MAX_MESSAGES || '', 10)
      || AI_CONFIG.CHAT_MAX_MESSAGES;
    const ttl = parseInt(process.env.AI_CHAT_HISTORY_TTL || '', 10)
      || AI_CONFIG.CHAT_HISTORY_TTL_SECONDS;

    try {
      // Read existing
      const existing = await this.getHistory(boardId, userId);

      // Append and trim to sliding window
      const combined = [...existing, ...newMessages];
      const trimmed = combined.slice(-maxMessages);

      // Write back with TTL
      await redis.setex(
        messagesKey(boardId, userId),
        ttl,
        JSON.stringify(trimmed)
      );
    } catch (err) {
      // Non-critical: losing chat history is acceptable
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Chat history write failed: ${message}`);
    }
  },

  /**
   * Purge all chat data for a user on a board.
   * Called when a user disconnects beyond the reconnect grace period.
   */
  async purgeChat(boardId: string, userId: string): Promise<void> {
    try {
      await redis.del(messagesKey(boardId, userId));
      await redis.del(convIdKey(boardId, userId));
      logger.debug(`Purged AI chat history for user ${userId} on board ${boardId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Chat purge failed: ${message}`);
    }
  },

  /**
   * Purge all chat data for ALL users on a board.
   * Could be used when a board is deleted.
   */
  async purgeBoardChats(boardId: string): Promise<void> {
    try {
      // Find all chat keys for this board
      const pattern = `ai:chat:${boardId}:*`;
      const keys = await scanKeys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.debug(`Purged ${keys.length} AI chat keys for board ${boardId}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Board chat purge failed: ${message}`);
    }
  },
};
