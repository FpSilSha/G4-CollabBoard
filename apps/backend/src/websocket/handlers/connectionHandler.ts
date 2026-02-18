import { Server, Socket } from 'socket.io';
import {
  WebSocketEvent,
  BoardJoinPayloadSchema,
  BoardLeavePayloadSchema,
  type BoardStatePayload,
  type UserJoinedPayload,
  type UserLeftPayload,
} from 'shared';
import { presenceService } from '../../services/presenceService';
import { boardService } from '../../services/boardService';
import { logger } from '../../utils/logger';
import { trackedEmit } from '../wsMetrics';
import { auditService, AuditAction } from '../../services/auditService';
import type { AuthenticatedSocket } from '../server';

export function registerConnectionHandlers(io: Server, socket: AuthenticatedSocket): void {
  /**
   * board:join — User joins a board room.
   * 1. Validate payload with Zod
   * 2. Validate board access
   * 3. Join Socket.io room
   * 4. Add to presence tracking
   * 5. Broadcast user:joined to room
   * 6. Send board:state to joining user
   */
  socket.on(WebSocketEvent.BOARD_JOIN, async (payload: unknown) => {
    const parsed = BoardJoinPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid board:join payload',
        timestamp: Date.now(),
      });
      return;
    }

    const { boardId } = parsed.data;
    const userId = socket.data.userId;

    try {
      // Validate board access (will throw if board not found / deleted)
      await boardService.getBoard(boardId, userId);

      // Leave any previous board room
      if (socket.data.currentBoardId) {
        await handleLeaveBoard(io, socket, socket.data.currentBoardId);
      }

      // Join the Socket.io room
      socket.join(boardId);
      socket.data.currentBoardId = boardId;

      // Load board state into Redis cache (or re-use existing cache)
      const cachedState = await boardService.getOrLoadBoardState(boardId);

      // Add to presence tracking in Redis
      const userInfo = {
        userId,
        name: socket.data.userName,
        avatar: socket.data.avatar,
        color: socket.data.color,
      };
      await presenceService.addUser(boardId, userInfo);

      // Update session with current board
      await presenceService.updateSessionBoard(socket.id, boardId);

      // Get all currently present users
      const users = await presenceService.getBoardUsers(boardId);

      // Send board state to the joining user (from Redis cache for consistency)
      const boardState: BoardStatePayload = {
        boardId,
        objects: cachedState.objects as BoardStatePayload['objects'],
        users,
      };
      trackedEmit(socket, WebSocketEvent.BOARD_STATE, boardState);

      // Broadcast user:joined to everyone else in the room
      const joinedPayload: UserJoinedPayload = {
        boardId,
        user: userInfo,
        timestamp: Date.now(),
      };
      trackedEmit(socket.to(boardId), WebSocketEvent.USER_JOINED, joinedPayload);

      auditService.log({
        userId,
        action: AuditAction.BOARD_JOIN,
        entityType: 'board',
        entityId: boardId,
      });

      logger.info(`User ${userId} joined board ${boardId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to join board';
      const code = (err as { code?: string }).code || 'JOIN_FAILED';
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code,
        message,
        timestamp: Date.now(),
      });
      logger.warn(`User ${userId} failed to join board ${boardId}: ${message}`);
    }
  });

  /**
   * board:leave — User voluntarily leaves a board room.
   */
  socket.on(WebSocketEvent.BOARD_LEAVE, async (payload: unknown) => {
    const parsed = BoardLeavePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid board:leave payload',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      await handleLeaveBoard(io, socket, parsed.data.boardId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to leave board';
      logger.error(`Error in board:leave for ${socket.data.userId}: ${message}`);
    }
  });

  /**
   * disconnect — Socket disconnected (network drop, tab close, etc.)
   */
  socket.on('disconnect', async (reason: string) => {
    const userId = socket.data.userId;
    const boardId = socket.data.currentBoardId;

    logger.info(`User ${userId} disconnected: ${reason}`);

    try {
      if (boardId) {
        await handleLeaveBoard(io, socket, boardId);
      }

      // Clean up: remove from all boards and session
      await presenceService.removeUserFromAllBoards(userId);
      await presenceService.removeSession(socket.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Error during disconnect cleanup for ${userId}: ${message}`);
    }
  });
}

/**
 * Shared logic for leaving a board room.
 */
async function handleLeaveBoard(io: Server, socket: AuthenticatedSocket, boardId: string): Promise<void> {
  const userId = socket.data.userId;

  // Remove from presence
  await presenceService.removeUser(boardId, userId);

  // Check if this was the last user — if so, flush Redis state to Postgres
  const remainingUsers = await presenceService.getBoardUsers(boardId);
  if (remainingUsers.length === 0) {
    try {
      const flushResult = await boardService.flushRedisToPostgres(boardId);
      if (flushResult.success) {
        logger.info(`Final save for board ${boardId}: flushed to Postgres (v${flushResult.newVersion})`);
      }
      await boardService.removeBoardFromRedis(boardId);
    } catch (flushErr: unknown) {
      const flushMessage = flushErr instanceof Error ? flushErr.message : 'Unknown error';
      logger.error(`Final save failed for board ${boardId}: ${flushMessage}`);
      // Non-fatal: user has already left, auto-save worker is the safety net
    }
  }

  // Leave Socket.io room
  socket.leave(boardId);

  // Clear current board from socket data
  if (socket.data.currentBoardId === boardId) {
    socket.data.currentBoardId = undefined;
  }

  // Broadcast user:left to remaining users in room
  const leftPayload: UserLeftPayload = {
    boardId,
    userId,
    timestamp: Date.now(),
  };
  trackedEmit(io.to(boardId), WebSocketEvent.USER_LEFT, leftPayload);

  auditService.log({
    userId,
    action: AuditAction.BOARD_LEAVE,
    entityType: 'board',
    entityId: boardId,
  });

  logger.info(`User ${userId} left board ${boardId}`);
}
