import { Server, Socket } from 'socket.io';
import {
  WebSocketEvent,
  type BoardJoinPayload,
  type BoardLeavePayload,
  type BoardStatePayload,
  type UserJoinedPayload,
  type UserLeftPayload,
} from 'shared';
import { presenceService } from '../../services/presenceService';
import { boardService } from '../../services/boardService';
import { logger } from '../../utils/logger';
import type { AuthenticatedSocket } from '../server';

export function registerConnectionHandlers(io: Server, socket: AuthenticatedSocket): void {
  /**
   * board:join — User joins a board room.
   * 1. Validate board access
   * 2. Join Socket.io room
   * 3. Add to presence tracking
   * 4. Broadcast user:joined to room
   * 5. Send board:state to joining user
   */
  socket.on(WebSocketEvent.BOARD_JOIN, async (payload: BoardJoinPayload) => {
    const { boardId } = payload;
    const userId = socket.data.userId;

    try {
      // Validate board access (will throw if unauthorized)
      const board = await boardService.getBoard(boardId, userId);

      // Leave any previous board room
      if (socket.data.currentBoardId) {
        await handleLeaveBoard(io, socket, socket.data.currentBoardId);
      }

      // Join the Socket.io room
      socket.join(boardId);
      socket.data.currentBoardId = boardId;

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

      // Send board state to the joining user
      const boardState: BoardStatePayload = {
        boardId,
        objects: board.objects as any[],
        users,
      };
      socket.emit(WebSocketEvent.BOARD_STATE, boardState);

      // Broadcast user:joined to everyone else in the room
      const joinedPayload: UserJoinedPayload = {
        boardId,
        user: userInfo,
        timestamp: Date.now(),
      };
      socket.to(boardId).emit(WebSocketEvent.USER_JOINED, joinedPayload);

      logger.info(`User ${userId} joined board ${boardId}`);
    } catch (err: any) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: err.code || 'JOIN_FAILED',
        message: err.message || 'Failed to join board',
        timestamp: Date.now(),
      });
      logger.warn(`User ${userId} failed to join board ${boardId}: ${err.message}`);
    }
  });

  /**
   * board:leave — User voluntarily leaves a board room.
   */
  socket.on(WebSocketEvent.BOARD_LEAVE, async (payload: BoardLeavePayload) => {
    const { boardId } = payload;
    await handleLeaveBoard(io, socket, boardId);
  });

  /**
   * disconnect — Socket disconnected (network drop, tab close, etc.)
   */
  socket.on('disconnect', async (reason: string) => {
    const userId = socket.data.userId;
    const boardId = socket.data.currentBoardId;

    logger.info(`User ${userId} disconnected: ${reason}`);

    if (boardId) {
      await handleLeaveBoard(io, socket, boardId);
    }

    // Clean up: remove from all boards and session
    await presenceService.removeUserFromAllBoards(userId);
    await presenceService.removeSession(socket.id);
  });
}

/**
 * Shared logic for leaving a board room.
 */
async function handleLeaveBoard(io: Server, socket: AuthenticatedSocket, boardId: string): Promise<void> {
  const userId = socket.data.userId;

  // Remove from presence
  await presenceService.removeUser(boardId, userId);

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
  io.to(boardId).emit(WebSocketEvent.USER_LEFT, leftPayload);

  logger.info(`User ${userId} left board ${boardId}`);
}
