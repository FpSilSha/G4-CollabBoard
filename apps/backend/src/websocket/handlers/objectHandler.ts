import { Server } from 'socket.io';
import {
  WebSocketEvent,
  ObjectCreatePayloadSchema,
  ObjectUpdatePayloadSchema,
  ObjectDeletePayloadSchema,
  ObjectUpdateFieldsSchema,
  type ObjectCreatedPayload,
  type ObjectUpdatedPayload,
  type ObjectDeletedPayload,
} from 'shared';
import { boardService } from '../../services/boardService';
import { editTrackingService } from '../../services/editTrackingService';
import { auditService, AuditAction } from '../../services/auditService';
import { logger } from '../../utils/logger';
import { trackedEmit } from '../wsMetrics';
import type { AuthenticatedSocket } from '../server';

/**
 * Register handlers for object CRUD events:
 *   object:create  — Client creates a new object
 *   object:update  — Client updates an existing object (move, resize, color, text)
 *   object:delete  — Client deletes an object
 *
 * All handlers:
 * 1. Zod-validate the payload
 * 2. Verify the user is in the target board room
 * 3. Persist to Redis via boardService (auto-save worker flushes to Postgres)
 * 4. Broadcast to room (created→all, updated/deleted→others)
 */
export function registerObjectHandlers(io: Server, socket: AuthenticatedSocket): void {
  // ========================================
  // object:create
  // ========================================
  socket.on(WebSocketEvent.OBJECT_CREATE, async (payload: unknown) => {
    const parsed = ObjectCreatePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid object:create payload',
        timestamp: Date.now(),
      });
      return;
    }

    const { boardId, object, timestamp } = parsed.data;
    const userId = socket.data.userId;

    // Verify user is in this board room
    if (socket.data.currentBoardId !== boardId) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'NOT_IN_BOARD',
        message: 'You must join the board before creating objects',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      // Build the full board object with server-authoritative timestamps
      const now = new Date();
      const boardObject = {
        ...object,
        createdBy: userId,
        lastEditedBy: userId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      // Persist to Redis (auto-save worker flushes to Postgres every 60s)
      await boardService.addObjectInRedis(boardId, boardObject);

      // Broadcast to ALL users in the room (including sender for confirmation)
      const createdPayload: ObjectCreatedPayload = {
        boardId,
        object: boardObject as unknown as ObjectCreatedPayload['object'],
        userId,
        timestamp: Date.now(),
      };

      trackedEmit(io.to(boardId), WebSocketEvent.OBJECT_CREATED, createdPayload);

      auditService.log({
        userId,
        action: AuditAction.OBJECT_CREATE,
        entityType: 'object',
        entityId: object.id,
        metadata: { boardId, objectType: object.type },
      });

      logger.info(`Object ${object.id} created on board ${boardId} by ${userId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create object';
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'CREATE_FAILED',
        message,
        timestamp: Date.now(),
      });
      logger.error(`object:create error for ${userId} on board ${boardId}: ${message}`);
    }
  });

  // ========================================
  // object:update
  // ========================================
  socket.on(WebSocketEvent.OBJECT_UPDATE, async (payload: unknown) => {
    const parsed = ObjectUpdatePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid object:update payload',
        timestamp: Date.now(),
      });
      return;
    }

    const { boardId, objectId, updates } = parsed.data;
    const userId = socket.data.userId;

    if (socket.data.currentBoardId !== boardId) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'NOT_IN_BOARD',
        message: 'You must join the board before updating objects',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      // Validate update fields
      const fieldsParsed = ObjectUpdateFieldsSchema.safeParse(updates);
      if (!fieldsParsed.success) {
        socket.emit(WebSocketEvent.BOARD_ERROR, {
          code: 'INVALID_UPDATES',
          message: 'Invalid update fields',
          timestamp: Date.now(),
        });
        return;
      }

      const sanitizedUpdates = {
        ...fieldsParsed.data,
        lastEditedBy: userId,
        updatedAt: new Date().toISOString(),
      };

      // Persist to Redis (LWW — auto-save worker flushes to Postgres every 60s)
      await boardService.updateObjectInRedis(boardId, objectId, sanitizedUpdates);

      // Check if another user is editing this object — warn them about the conflict
      const activeEditor = await editTrackingService.getActiveEditor(boardId, objectId, userId);
      if (activeEditor) {
        // Find the other editor's socket and send them a conflict warning
        const socketsInRoom = await io.in(boardId).fetchSockets();
        const editorSocket = socketsInRoom.find((s) => s.data.userId === activeEditor.userId);
        if (editorSocket) {
          trackedEmit(editorSocket, WebSocketEvent.CONFLICT_WARNING, {
            boardId,
            objectId,
            conflictingUserId: userId,
            conflictingUserName: socket.data.userName,
            message: `${socket.data.userName} also modified this object`,
            timestamp: Date.now(),
          });
        }
      }

      // Broadcast to everyone EXCEPT sender (sender has optimistic local state)
      const updatedPayload: ObjectUpdatedPayload = {
        boardId,
        objectId,
        updates: sanitizedUpdates as unknown as ObjectUpdatedPayload['updates'],
        userId,
        timestamp: Date.now(),
      };

      trackedEmit(socket.to(boardId), WebSocketEvent.OBJECT_UPDATED, updatedPayload);

      auditService.log({
        userId,
        action: AuditAction.OBJECT_UPDATE,
        entityType: 'object',
        entityId: objectId,
        metadata: { boardId, updatedFields: Object.keys(updates) },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update object';
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'UPDATE_FAILED',
        message,
        timestamp: Date.now(),
      });
      logger.error(`object:update error for ${userId} on board ${boardId}: ${message}`);
    }
  });

  // ========================================
  // object:delete
  // ========================================
  socket.on(WebSocketEvent.OBJECT_DELETE, async (payload: unknown) => {
    const parsed = ObjectDeletePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid object:delete payload',
        timestamp: Date.now(),
      });
      return;
    }

    const { boardId, objectId } = parsed.data;
    const userId = socket.data.userId;

    if (socket.data.currentBoardId !== boardId) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'NOT_IN_BOARD',
        message: 'You must join the board before deleting objects',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      // Remove from Redis (auto-save worker flushes to Postgres every 60s)
      await boardService.removeObjectFromRedis(boardId, objectId);

      // Broadcast to everyone EXCEPT sender
      const deletedPayload: ObjectDeletedPayload = {
        boardId,
        objectId,
        userId,
        timestamp: Date.now(),
      };

      trackedEmit(socket.to(boardId), WebSocketEvent.OBJECT_DELETED, deletedPayload);

      auditService.log({
        userId,
        action: AuditAction.OBJECT_DELETE,
        entityType: 'object',
        entityId: objectId,
        metadata: { boardId },
      });

      logger.info(`Object ${objectId} deleted from board ${boardId} by ${userId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete object';
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'DELETE_FAILED',
        message,
        timestamp: Date.now(),
      });
      logger.error(`object:delete error for ${userId} on board ${boardId}: ${message}`);
    }
  });
}
