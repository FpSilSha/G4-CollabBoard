import { Server } from 'socket.io';
import {
  WebSocketEvent,
  EditStartPayloadSchema,
  EditEndPayloadSchema,
  type ConflictWarningPayload,
} from 'shared';
import { editTrackingService } from '../../services/editTrackingService';
import { logger } from '../../utils/logger';
import { trackedEmit } from '../wsMetrics';
import type { AuthenticatedSocket } from '../server';

/**
 * Register handlers for edit tracking events:
 *   edit:start — Client selects an object for editing
 *   edit:end   — Client deselects an object
 *
 * If another user is already editing the same object, a conflict:warning
 * is emitted back to the requesting socket.
 */
export function registerEditHandlers(io: Server, socket: AuthenticatedSocket): void {
  // ========================================
  // edit:start
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

    // Verify user is in this board room
    if (socket.data.currentBoardId !== boardId) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'NOT_IN_BOARD',
        message: 'You are not in this board',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      const existingEditor = await editTrackingService.startEdit(
        boardId,
        objectId,
        userId,
        userName
      );

      if (existingEditor) {
        // Another user is already editing — warn the requester
        const warning: ConflictWarningPayload = {
          boardId,
          objectId,
          conflictingUserId: existingEditor.userId,
          conflictingUserName: existingEditor.userName,
          message: `${existingEditor.userName} is currently editing this object`,
          timestamp: Date.now(),
        };
        trackedEmit(socket, WebSocketEvent.CONFLICT_WARNING, warning);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`edit:start failed for object ${objectId}: ${message}`);
    }
  });

  // ========================================
  // edit:end
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

    // Verify user is in this board room
    if (socket.data.currentBoardId !== boardId) {
      return; // Silently ignore — user may have already left
    }

    try {
      await editTrackingService.endEdit(boardId, objectId, userId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`edit:end failed for object ${objectId}: ${message}`);
    }
  });
}
