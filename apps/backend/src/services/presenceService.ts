import { redis } from '../utils/redis';
import { WEBSOCKET_CONFIG } from 'shared';
import type { BoardUserInfo } from 'shared';
import { logger } from '../utils/logger';

const PRESENCE_TTL = WEBSOCKET_CONFIG.PRESENCE_TTL; // 30 seconds

interface PresenceData {
  userId: string;
  name: string;
  avatar: string;
  color: string;
  lastHeartbeat: number;
}

export const presenceService = {
  /**
   * Add a user to a board's presence set.
   * Stores user info in Redis with a TTL.
   */
  async addUser(boardId: string, user: BoardUserInfo): Promise<void> {
    const key = `presence:${boardId}:${user.userId}`;
    const data: PresenceData = {
      userId: user.userId,
      name: user.name,
      avatar: user.avatar,
      color: user.color,
      lastHeartbeat: Date.now(),
    };
    await redis.setex(key, PRESENCE_TTL, JSON.stringify(data));
  },

  /**
   * Remove a user from a board's presence.
   */
  async removeUser(boardId: string, userId: string): Promise<void> {
    const key = `presence:${boardId}:${userId}`;
    await redis.del(key);
  },

  /**
   * Refresh a user's presence TTL (called on heartbeat).
   */
  async refreshPresence(boardId: string, userId: string): Promise<void> {
    const key = `presence:${boardId}:${userId}`;
    const existing = await redis.get(key);
    if (existing) {
      const data: PresenceData = JSON.parse(existing);
      data.lastHeartbeat = Date.now();
      await redis.setex(key, PRESENCE_TTL, JSON.stringify(data));
    }
  },

  /**
   * Get all users currently present on a board.
   */
  async getBoardUsers(boardId: string): Promise<BoardUserInfo[]> {
    const pattern = `presence:${boardId}:*`;
    const keys = await redis.keys(pattern);

    if (keys.length === 0) return [];

    const pipeline = redis.pipeline();
    keys.forEach((key) => pipeline.get(key));
    const results = await pipeline.exec();

    if (!results) return [];

    const users: BoardUserInfo[] = [];
    for (const [err, value] of results) {
      if (err || !value) continue;
      try {
        const data: PresenceData = JSON.parse(value as string);
        users.push({
          userId: data.userId,
          name: data.name,
          avatar: data.avatar,
          color: data.color,
        });
      } catch {
        // Skip malformed entries
      }
    }
    return users;
  },

  /**
   * Remove a user from ALL boards (called on socket disconnect).
   * Scans for all presence keys matching this userId.
   */
  async removeUserFromAllBoards(userId: string): Promise<string[]> {
    const pattern = `presence:*:${userId}`;
    const keys = await redis.keys(pattern);
    const boardIds: string[] = [];

    if (keys.length > 0) {
      for (const key of keys) {
        // key format: presence:{boardId}:{userId}
        const parts = key.split(':');
        if (parts.length === 3) {
          boardIds.push(parts[1]);
        }
      }
      await redis.del(...keys);
    }

    return boardIds;
  },

  /**
   * Store WebSocket session info for a connected socket.
   */
  async setSession(socketId: string, userId: string, boardId?: string): Promise<void> {
    const key = `ws:session:${socketId}`;
    const data = {
      userId,
      boardId: boardId || null,
      connectedAt: Date.now(),
    };
    await redis.setex(key, 86400, JSON.stringify(data)); // 24h TTL
  },

  /**
   * Get the session data for a socket.
   */
  async getSession(socketId: string): Promise<{ userId: string; boardId: string | null } | null> {
    const key = `ws:session:${socketId}`;
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data);
  },

  /**
   * Update the boardId in a session.
   */
  async updateSessionBoard(socketId: string, boardId: string | null): Promise<void> {
    const key = `ws:session:${socketId}`;
    const data = await redis.get(key);
    if (data) {
      const session = JSON.parse(data);
      session.boardId = boardId;
      await redis.setex(key, 86400, JSON.stringify(session));
    }
  },

  /**
   * Remove session on disconnect.
   */
  async removeSession(socketId: string): Promise<void> {
    const key = `ws:session:${socketId}`;
    await redis.del(key);
  },
};
