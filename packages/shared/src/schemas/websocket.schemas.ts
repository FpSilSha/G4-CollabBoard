import { z } from 'zod';

/**
 * Zod schemas for WebSocket event payloads.
 *
 * These validate every inbound socket event at runtime to prevent
 * malicious or malformed data from reaching handlers, Redis, or
 * being broadcast to other clients.
 */

const coordinate = z.number().min(-1000000).max(1000000);

// board:join
export const BoardJoinPayloadSchema = z.object({
  boardId: z.string().uuid(),
});

// board:leave
export const BoardLeavePayloadSchema = z.object({
  boardId: z.string().uuid(),
});

// cursor:move — coordinates and timestamp
export const CursorMovePayloadSchema = z.object({
  boardId: z.string().uuid(),
  x: coordinate,
  y: coordinate,
  timestamp: z.number().int().positive(),
});

// heartbeat
export const HeartbeatPayloadSchema = z.object({
  boardId: z.string().uuid(),
  timestamp: z.number().int().positive(),
});

// object:create
export const ObjectCreatePayloadSchema = z.object({
  boardId: z.string().uuid(),
  object: z.record(z.unknown()), // Validated further by BoardObjectCreateSchema if needed
  timestamp: z.number().int().positive(),
});

// object:update
export const ObjectUpdatePayloadSchema = z.object({
  boardId: z.string().uuid(),
  objectId: z.string().min(1),
  updates: z.record(z.unknown()),
  timestamp: z.number().int().positive(),
});

// object:delete
export const ObjectDeletePayloadSchema = z.object({
  boardId: z.string().uuid(),
  objectId: z.string().min(1),
  timestamp: z.number().int().positive(),
});
