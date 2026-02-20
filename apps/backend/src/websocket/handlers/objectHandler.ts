import { Server } from 'socket.io';
import {
  WebSocketEvent,
  ObjectCreatePayloadSchema,
  ObjectUpdatePayloadSchema,
  ObjectDeletePayloadSchema,
  ObjectUpdateFieldsSchema,
  ObjectsBatchMovePayloadSchema,
  ObjectsBatchCreatePayloadSchema,
  ObjectsBatchDeletePayloadSchema,
  type ObjectCreatedPayload,
  type ObjectUpdatedPayload,
  type ObjectDeletedPayload,
  type ObjectsBatchMovedPayload,
  type ObjectsBatchCreatedPayload,
  type ObjectsBatchDeletedPayload,
} from 'shared';
import { boardService } from '../../services/boardService';
import { editLockService } from '../../services/editLockService';
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

      // If this update includes text, refresh the edit lock TTL so it
      // doesn't expire during a long editing session (TTL is only 20s).
      if (fieldsParsed.data.text !== undefined) {
        await editLockService.refreshLock(boardId, objectId, userId);
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

  // ========================================
  // objects:batch_update (multi-select drag)
  // ========================================
  // Lightweight position-only batch: one message for all dragged objects.
  // Single Redis read/write cycle, single broadcast.
  socket.on(WebSocketEvent.OBJECTS_BATCH_UPDATE, async (payload: unknown) => {
    const parsed = ObjectsBatchMovePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid objects:batch_update payload',
        timestamp: Date.now(),
      });
      return;
    }

    const { boardId, moves } = parsed.data;
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
      const now = new Date().toISOString();

      // Single Redis read, apply all position updates, single Redis write
      const cachedState = await boardService.getOrLoadBoardState(boardId);

      for (const move of moves) {
        const objIndex = cachedState.objects.findIndex(
          (obj) => obj.id === move.objectId
        );
        if (objIndex === -1) continue;

        cachedState.objects[objIndex] = {
          ...cachedState.objects[objIndex],
          x: move.x,
          y: move.y,
          lastEditedBy: userId,
          updatedAt: now,
        } as unknown as typeof cachedState.objects[number];
      }

      await boardService.saveBoardStateToRedis(boardId, cachedState);

      // Single broadcast to all other users
      const batchPayload: ObjectsBatchMovedPayload = {
        boardId,
        moves,
        userId,
        timestamp: Date.now(),
      };

      trackedEmit(socket.to(boardId), WebSocketEvent.OBJECTS_BATCH_UPDATE, batchPayload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to batch update objects';
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'BATCH_UPDATE_FAILED',
        message,
        timestamp: Date.now(),
      });
      logger.error(`objects:batch_update error for ${userId} on board ${boardId}: ${message}`);
    }
  });

  // ========================================
  // objects:batch_create (paste operations)
  // ========================================
  // Creates multiple objects in a single message to avoid rate-limit issues.
  // Follows the same pattern as batch_update: single Redis read/write, single broadcast.
  socket.on(WebSocketEvent.OBJECTS_BATCH_CREATE, async (payload: unknown) => {
    const parsed = ObjectsBatchCreatePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid objects:batch_create payload',
        timestamp: Date.now(),
      });
      return;
    }

    const { boardId, objects } = parsed.data;
    const userId = socket.data.userId;

    if (socket.data.currentBoardId !== boardId) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'NOT_IN_BOARD',
        message: 'You must join the board before creating objects',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      const now = new Date();
      const createdObjects = [];

      // Single Redis read, add all objects, single Redis write
      const cachedState = await boardService.getOrLoadBoardState(boardId);

      for (const object of objects) {
        const boardObject = {
          ...object,
          createdBy: userId,
          lastEditedBy: userId,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };

        cachedState.objects.push(boardObject as unknown as typeof cachedState.objects[number]);
        createdObjects.push(boardObject);
      }

      await boardService.saveBoardStateToRedis(boardId, cachedState);

      // Single broadcast to ALL users in the room (including sender for confirmation)
      const batchPayload: ObjectsBatchCreatedPayload = {
        boardId,
        objects: createdObjects as unknown as ObjectsBatchCreatedPayload['objects'],
        userId,
        timestamp: Date.now(),
      };

      trackedEmit(io.to(boardId), WebSocketEvent.OBJECTS_BATCH_CREATED, batchPayload);

      for (const object of objects) {
        auditService.log({
          userId,
          action: AuditAction.OBJECT_CREATE,
          entityType: 'object',
          entityId: object.id,
          metadata: { boardId, objectType: object.type, batch: true },
        });
      }

      logger.info(`Batch created ${objects.length} objects on board ${boardId} by ${userId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to batch create objects';
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'BATCH_CREATE_FAILED',
        message,
        timestamp: Date.now(),
      });
      logger.error(`objects:batch_create error for ${userId} on board ${boardId}: ${message}`);
    }
  });

  // ========================================
  // objects:batch_delete (multi-select delete)
  // ========================================
  // Deletes multiple objects in a single message to avoid rate-limit issues
  // when the user selects many objects and presses Delete.
  socket.on(WebSocketEvent.OBJECTS_BATCH_DELETE, async (payload: unknown) => {
    const parsed = ObjectsBatchDeletePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid objects:batch_delete payload',
        timestamp: Date.now(),
      });
      return;
    }

    const { boardId, objectIds } = parsed.data;
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
      // Single Redis read, remove all objects, single Redis write
      const cachedState = await boardService.getOrLoadBoardState(boardId);
      const objectIdSet = new Set(objectIds);

      cachedState.objects = cachedState.objects.filter(
        (obj) => !objectIdSet.has(obj.id)
      );

      await boardService.saveBoardStateToRedis(boardId, cachedState);

      // Single broadcast to everyone EXCEPT sender
      const batchPayload: ObjectsBatchDeletedPayload = {
        boardId,
        objectIds,
        userId,
        timestamp: Date.now(),
      };

      trackedEmit(socket.to(boardId), WebSocketEvent.OBJECTS_BATCH_DELETED, batchPayload);

      for (const objectId of objectIds) {
        auditService.log({
          userId,
          action: AuditAction.OBJECT_DELETE,
          entityType: 'object',
          entityId: objectId,
          metadata: { boardId, batch: true },
        });
      }

      logger.info(`Batch deleted ${objectIds.length} objects from board ${boardId} by ${userId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to batch delete objects';
      socket.emit(WebSocketEvent.BOARD_ERROR, {
        code: 'BATCH_DELETE_FAILED',
        message,
        timestamp: Date.now(),
      });
      logger.error(`objects:batch_delete error for ${userId} on board ${boardId}: ${message}`);
    }
  });
}
