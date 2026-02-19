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
 * Multi-user edit locks:
 *   - All users CAN edit the same object simultaneously (LWW decides winner).
 *   - edit:start acquires a per-user lock and returns a list of other editors.
 *   - edit:warning is sent to the requester with other editors' info.
 *   - edit:start is broadcast to the room so existing editors see the warning.
 *   - edit:end releases the user's lock and broadcasts edit:end to the room.
 *
 * On disconnect, connectionHandler preserves locks (TTL-based grace period)
 * so the user can reclaim on reconnect.
 */
export function registerEditHandlers(io: Server, socket: AuthenticatedSocket): void {
  // ========================================
  // edit:start — user opens edit modal on a sticky
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
    const userName = socket.data.userName;

    if (socket.data.currentBoardId !== boardId) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'NOT_IN_BOARD',
        message: 'You must join the board before editing objects',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      // Acquire per-user lock — always succeeds; returns other editors
      const { otherEditors } = await editLockService.acquireLock(
        boardId, objectId, userId, userName
      );

      // If other users are editing this object, send a warning to the requester
      if (otherEditors.length > 0) {
        trackedEmit(socket, WebSocketEvent.EDIT_WARNING, {
          boardId,
          objectId,
          editors: otherEditors,
          timestamp: Date.now(),
        });
      }

      // Broadcast edit:start to other users in the room so they can show
      // a mid-edit warning if they're also editing this object
      trackedEmit(socket.to(boardId), WebSocketEvent.EDIT_START, {
        boardId,
        objectId,
        userId,
        userName,
        timestamp: Date.now(),
      });

      logger.info(`Edit lock acquired: ${objectId} by ${userId} (${userName}) on board ${boardId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to acquire edit lock';
      logger.error(`edit:start error for ${userId}: ${message}`);
    }
  });

  // ========================================
  // edit:end — user closes edit modal (confirm / cancel)
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

      logger.info(`Edit lock released: ${objectId} by ${userId} on board ${boardId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to release edit lock';
      logger.error(`edit:end error for ${userId}: ${message}`);
    }
  });
}
