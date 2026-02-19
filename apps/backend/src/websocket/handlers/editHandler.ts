import { Server } from 'socket.io';
import {
  WebSocketEvent,
  EditStartPayloadSchema,
  EditEndPayloadSchema,
} from 'shared';
import { editLockService } from '../../services/editLockService';
import { logger } from '../../utils/logger';
import { trackedEmit } from '../wsMetrics';
import type { AuthenticatedSocket } from '../server';

/**
 * Handles edit:start and edit:end events for advisory edit locks.
 *
 * - edit:start: Acquires a Redis lock for the object. Broadcasts
 *   edit:start to other users so their clients know who is editing.
 * - edit:end: Releases the lock. Broadcasts edit:end to other users.
 *
 * On disconnect, connectionHandler checks for active locks and lets
 * them persist (TTL-based grace period) so the user can reclaim on reconnect.
 */
export function registerEditHandlers(io: Server, socket: AuthenticatedSocket): void {
  // ========================================
  // edit:start — user opens textarea on a sticky
  // ========================================
  socket.on(WebSocketEvent.EDIT_START, async (payload: unknown) => {
    const parsed = EditStartPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid edit:start payload',
        timestamp: Date.now(),
      });
      return;
    }

    const { boardId, objectId } = parsed.data;
    const userId = socket.data.userId;

    if (socket.data.currentBoardId !== boardId) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'NOT_IN_BOARD',
        message: 'You must join the board before editing objects',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      const result = await editLockService.acquireLock(boardId, objectId, userId);

      if (!result.acquired) {
        // Another user holds the lock — inform the requester
        socket.emit(WebSocketEvent.BOARD_ERROR, {
          code: 'EDIT_LOCKED',
          message: `Object is being edited by another user`,
          timestamp: Date.now(),
        });
        return;
      }

      // Broadcast edit:start to other users in the room
      trackedEmit(socket.to(boardId), WebSocketEvent.EDIT_START, {
        boardId,
        objectId,
        userId,
        userName: socket.data.userName,
        timestamp: Date.now(),
      });

      logger.debug(`Edit lock acquired: ${objectId} by ${userId} on board ${boardId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to acquire edit lock';
      logger.error(`edit:start error for ${userId}: ${message}`);
    }
  });

  // ========================================
  // edit:end — user closes textarea (blur)
  // ========================================
  socket.on(WebSocketEvent.EDIT_END, async (payload: unknown) => {
    const parsed = EditEndPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid edit:end payload',
        timestamp: Date.now(),
      });
      return;
    }

    const { boardId, objectId } = parsed.data;
    const userId = socket.data.userId;

    try {
      await editLockService.releaseLock(boardId, objectId, userId);

      // Broadcast edit:end to other users in the room
      trackedEmit(socket.to(boardId), WebSocketEvent.EDIT_END, {
        boardId,
        objectId,
        userId,
        timestamp: Date.now(),
      });

      logger.debug(`Edit lock released: ${objectId} by ${userId} on board ${boardId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to release edit lock';
      logger.error(`edit:end error for ${userId}: ${message}`);
    }
  });
}
