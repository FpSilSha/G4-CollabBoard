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

// edit:start — user begins editing an object
export const EditStartPayloadSchema = z.object({
  boardId: z.string().uuid(),
  objectId: z.string().min(1),
  timestamp: z.number().int().positive(),
});

// edit:end — user stops editing an object
export const EditEndPayloadSchema = z.object({
  boardId: z.string().uuid(),
  objectId: z.string().min(1),
  timestamp: z.number().int().positive(),
});

// object:create — client sends object with client-generated UUID
export const ObjectCreatePayloadSchema = z.object({
  boardId: z.string().uuid(),
  object: z.object({
    id: z.string().uuid(),
    type: z.enum(['sticky', 'shape', 'frame', 'connector', 'text']),
  }).passthrough(), // Allow additional type-specific fields
  timestamp: z.number().int().positive(),
});

// object:update — partial field updates
export const ObjectUpdatePayloadSchema = z.object({
  boardId: z.string().uuid(),
  objectId: z.string().min(1),
  updates: z.record(z.unknown()),
  timestamp: z.number().int().positive(),
});

// object:update fields — validates the allowed update fields
export const ObjectUpdateFieldsSchema = z.object({
  x: coordinate.optional(),
  y: coordinate.optional(),
  x2: coordinate.optional(),
  y2: coordinate.optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  text: z.string().max(10000).optional(),
  width: z.number().min(10).max(5000).optional(),
  height: z.number().min(10).max(5000).optional(),
  rotation: z.number().min(-360).max(360).optional(),
  fontSize: z.number().min(8).max(200).optional(),
  title: z.string().max(255).optional(),
  lastEditedBy: z.string().optional(),
  updatedAt: z.any().optional(),
  frameId: z.string().uuid().nullable().optional(),
  locked: z.boolean().optional(),
}).passthrough();

// object:delete
export const ObjectDeletePayloadSchema = z.object({
  boardId: z.string().uuid(),
  objectId: z.string().min(1),
  timestamp: z.number().int().positive(),
});

// objects:batch_update — lightweight position-only batch for multi-select drag
export const ObjectsBatchMovePayloadSchema = z.object({
  boardId: z.string().uuid(),
  moves: z.array(z.object({
    objectId: z.string().min(1),
    x: coordinate,
    y: coordinate,
  })).min(1).max(50), // Reasonable cap
  timestamp: z.number().int().positive(),
});

// objects:batch_create — batch create for paste operations
// Sends all pasted objects in a single message to avoid rate-limit issues
export const ObjectsBatchCreatePayloadSchema = z.object({
  boardId: z.string().uuid(),
  objects: z.array(z.object({
    id: z.string().uuid(),
    type: z.enum(['sticky', 'shape', 'frame', 'connector', 'text']),
  }).passthrough()).min(1).max(50), // Cap at 50 objects per batch
  timestamp: z.number().int().positive(),
});
