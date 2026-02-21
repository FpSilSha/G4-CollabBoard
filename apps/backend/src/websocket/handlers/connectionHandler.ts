import { Server, Socket } from 'socket.io';
import {
  WebSocketEvent,
  BoardJoinPayloadSchema,
  BoardLeavePayloadSchema,
  USER_COLORS,
  type BoardStatePayload,
  type UserJoinedPayload,
  type UserLeftPayload,
} from 'shared';
import { presenceService } from '../../services/presenceService';
import { boardService } from '../../services/boardService';
import { editLockService } from '../../services/editLockService';
import { teleportFlagService } from '../../services/teleportFlagService';
import { aiChatService } from '../../services/aiChatService';
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

      // Assign a slot-based presence color for this board.
      // First user gets color 0, second gets color 1, etc.
      // When a user leaves, their color slot opens up for the next joiner.
      const existingUsers = await presenceService.getBoardUsers(boardId);
      const takenColors = new Set(existingUsers.map((u) => u.color));
      const slotColor = USER_COLORS.find((c) => !takenColors.has(c))
        ?? USER_COLORS[existingUsers.length % USER_COLORS.length];

      // Add to presence tracking in Redis with slot-based color
      const userInfo = {
        userId,
        name: socket.data.userName,
        avatar: socket.data.avatar,
        color: slotColor,
      };
      await presenceService.addUser(boardId, userInfo);

      // Update session with current board
      await presenceService.updateSessionBoard(socket.id, boardId);

      // Get all currently present users + teleport flags
      const [users, flagResult] = await Promise.all([
        presenceService.getBoardUsers(boardId),
        teleportFlagService.listFlags(boardId),
      ]);

      // Send board state to the joining user (from Redis cache for consistency)
      const boardState: BoardStatePayload = {
        boardId,
        objects: cachedState.objects as BoardStatePayload['objects'],
        users,
        flags: flagResult.flags,
      };
      trackedEmit(socket, WebSocketEvent.BOARD_STATE, boardState);

      // Broadcast user:joined to everyone else in the room
      const joinedPayload: UserJoinedPayload = {
        boardId,
        user: userInfo,
        timestamp: Date.now(),
      };
      trackedEmit(socket.to(boardId), WebSocketEvent.USER_JOINED, joinedPayload);

      // --- Reconnect edit-lock reclaim ---
      // If the user disconnected while editing a sticky, they may still hold
      // a Redis edit lock (TTL-based grace period). Refresh those locks and
      // tell the client which objects it was editing so the frontend can
      // restore the textarea and skip those objects in the board:state rebuild.
      const activeLocks = await editLockService.getUserLocks(boardId, userId);
      if (activeLocks.length > 0) {
        // Refresh lock TTLs (user is back, reset the countdown)
        for (const objectId of activeLocks) {
          await editLockService.refreshLock(boardId, objectId, userId);
        }
        // Tell the client which objects it was editing
        trackedEmit(socket, 'edit:reclaim', {
          boardId,
          objectIds: activeLocks,
          timestamp: Date.now(),
        });
        // Broadcast edit:start to the room so other users see
        // this user is still editing (for concurrent edit warnings)
        for (const objectId of activeLocks) {
          trackedEmit(socket.to(boardId), WebSocketEvent.EDIT_START, {
            boardId,
            objectId,
            userId,
            userName: socket.data.userName,
            timestamp: Date.now(),
          });
        }
        logger.info(`User ${userId} reclaimed edit locks on board ${boardId}: ${activeLocks.join(', ')}`);
      }

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
   *
   * Only removes user presence when this is their LAST active socket.
   * This prevents a duplicate-session kick from wiping presence while
   * the replacement socket is still connected.
   */
  socket.on('disconnect', async (reason: string) => {
    const userId = socket.data.userId;
    const boardId = socket.data.currentBoardId;

    logger.info(`User ${userId} disconnected: ${reason}`);

    try {
      // Check if this user still has another active socket
      const remainingSockets = await io.fetchSockets();
      const userStillConnected = remainingSockets.some(
        (s) => s.id !== socket.id && (s as unknown as AuthenticatedSocket).data.userId === userId
      );

      if (boardId && !userStillConnected) {
        // Last socket — full cleanup with edit lock grace period
        await handleLeaveBoard(io, socket, boardId, true);
      }

      // Always remove THIS socket's session
      await presenceService.removeSession(socket.id);

      // Only remove from all boards if no other socket remains
      if (!userStillConnected) {
        await presenceService.removeUserFromAllBoards(userId);
      } else {
        logger.info(`User ${userId} still has active socket(s) — skipping presence cleanup`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Error during disconnect cleanup for ${userId}: ${message}`);
    }
  });

  /**
   * board:request_sync — Client requests a full state rebuild.
   * Used by ConflictModal when user clicks "Accept their changes".
   * Reads current state from Redis and emits board:sync_response to requester only.
   */
  socket.on(WebSocketEvent.BOARD_REQUEST_SYNC, async (payload: unknown) => {
    const parsed = BoardJoinPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid board:request_sync payload',
        timestamp: Date.now(),
      });
      return;
    }

    const { boardId } = parsed.data;
    const userId = socket.data.userId;

    if (socket.data.currentBoardId !== boardId) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'NOT_IN_BOARD',
        message: 'You are not in this board',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      const cachedState = await boardService.getOrLoadBoardState(boardId);
      const [users, flagResult] = await Promise.all([
        presenceService.getBoardUsers(boardId),
        teleportFlagService.listFlags(boardId),
      ]);

      const syncResponse: BoardStatePayload = {
        boardId,
        objects: cachedState.objects as BoardStatePayload['objects'],
        users,
        flags: flagResult.flags,
      };

      trackedEmit(socket, WebSocketEvent.BOARD_SYNC_RESPONSE, syncResponse);
      logger.debug(`Sync response sent to ${userId} for board ${boardId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to sync board';
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'SYNC_FAILED',
        message,
        timestamp: Date.now(),
      });
      logger.error(`board:request_sync failed for ${userId}: ${message}`);
    }
  });
}

/**
 * Shared logic for leaving a board room.
 * @param isDisconnect When true, edit locks are preserved (TTL grace period).
 *   When false (voluntary leave / navigation), locks are released immediately.
 */
async function handleLeaveBoard(
  io: Server,
  socket: AuthenticatedSocket,
  boardId: string,
  isDisconnect = false
): Promise<void> {
  const userId = socket.data.userId;

  // Release edit locks on voluntary leave (not disconnect — keep TTL grace period)
  if (!isDisconnect) {
    try {
      const locks = await editLockService.getUserLocks(boardId, userId);
      for (const objectId of locks) {
        await editLockService.releaseLock(boardId, objectId, userId);
      }
      if (locks.length > 0) {
        logger.debug(`Released ${locks.length} edit lock(s) for ${userId} on board ${boardId}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Failed to release edit locks for ${userId}: ${msg}`);
    }

    // Purge AI chat history on voluntary leave (not disconnect — keep for reconnect)
    aiChatService.purgeChat(boardId, userId).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Failed to purge AI chat for ${userId}: ${msg}`);
    });
  }

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
