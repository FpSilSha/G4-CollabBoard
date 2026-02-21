import { v4 as uuidv4 } from 'uuid';
import {
  WebSocketEvent,
  AI_COLORS,
  AI_BROADCAST_USER_ID,
  MAX_OBJECTS_PER_BOARD,
  type ViewportBounds,
  type AIOperation,
  type BoardObject,
  type ObjectCreatedPayload,
  type ObjectUpdatedPayload,
  type ObjectDeletedPayload,
} from 'shared';
import { boardService } from '../services/boardService';
import { getIO } from '../websocket/server';
import { trackedEmit } from '../websocket/wsMetrics';
import { logger } from '../utils/logger';
import {
  isObjectInViewport,
  getViewportFilteredObjects,
  summarizeObject,
  getObjectById,
} from './viewportUtils';
import type { AIToolName } from './tools';

// ============================================================
// Tool Executor — Bridge from AI tool calls to boardService
// ============================================================

/** Result returned by every tool execution. */
export interface ToolExecutionResult {
  /** JSON output to return to the LLM as the tool_result. */
  output: Record<string, unknown>;
  /** Operation record for the AICommandResponse.operations array. */
  operation: AIOperation;
}

// ============================================================
// Guards
// ============================================================

/**
 * Check that the board hasn't hit the hard object cap (2000).
 * Throws an Error that the tool executor catch block converts
 * into a tool_result error for the LLM to see.
 */
async function assertBoardNotFull(boardId: string): Promise<void> {
  const cached = await boardService.getBoardStateFromRedis(boardId);
  if (cached && cached.objects.length >= MAX_OBJECTS_PER_BOARD) {
    throw new Error(
      `Board has reached the maximum of ${MAX_OBJECTS_PER_BOARD} objects. ` +
      `Delete some objects before creating new ones.`
    );
  }
}

// ============================================================
// Individual Tool Implementations
// ============================================================

async function executeCreateStickyNote(
  input: Record<string, unknown>,
  boardId: string,
  userId: string
): Promise<ToolExecutionResult> {
  await assertBoardNotFull(boardId);
  const id = uuidv4();
  const now = new Date();
  const object: Record<string, unknown> = {
    id,
    type: 'sticky',
    text: input.text as string,
    x: input.x as number,
    y: input.y as number,
    color: (input.color as string) || AI_COLORS.STICKY_YELLOW,
    width: (input.width as number) || 200,
    height: (input.height as number) || 150,
    frameId: (input.frameId as string) || null,
    createdBy: userId,
    lastEditedBy: userId,
    createdVia: 'ai',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await boardService.addObjectInRedis(boardId, object);

  const payload: ObjectCreatedPayload = {
    boardId,
    object: object as unknown as BoardObject,
    userId: AI_BROADCAST_USER_ID,
    timestamp: Date.now(),
  };
  trackedEmit(getIO().to(boardId), WebSocketEvent.OBJECT_CREATED, payload);

  return {
    output: {
      objectId: id,
      success: true,
      type: 'sticky',
      message: `Created sticky note '${(input.text as string).slice(0, 40)}' at (${input.x}, ${input.y})`,
    },
    operation: {
      type: 'create',
      objectType: 'sticky',
      objectId: id,
      details: { text: input.text, x: input.x, y: input.y, color: object.color },
    },
  };
}

async function executeCreateShape(
  input: Record<string, unknown>,
  boardId: string,
  userId: string
): Promise<ToolExecutionResult> {
  await assertBoardNotFull(boardId);
  const id = uuidv4();
  const now = new Date();
  const object: Record<string, unknown> = {
    id,
    type: 'shape',
    shapeType: input.shapeType as string,
    x: input.x as number,
    y: input.y as number,
    width: input.width as number,
    height: input.height as number,
    color: (input.color as string) || '#E0E0E0',
    rotation: (input.rotation as number) || 0,
    frameId: null,
    createdBy: userId,
    lastEditedBy: userId,
    createdVia: 'ai',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await boardService.addObjectInRedis(boardId, object);

  const payload: ObjectCreatedPayload = {
    boardId,
    object: object as unknown as BoardObject,
    userId: AI_BROADCAST_USER_ID,
    timestamp: Date.now(),
  };
  trackedEmit(getIO().to(boardId), WebSocketEvent.OBJECT_CREATED, payload);

  return {
    output: {
      objectId: id,
      success: true,
      type: 'shape',
      message: `Created ${input.shapeType} at (${input.x}, ${input.y})`,
    },
    operation: {
      type: 'create',
      objectType: 'shape',
      objectId: id,
      details: { shapeType: input.shapeType, x: input.x, y: input.y },
    },
  };
}

async function executeCreateFrame(
  input: Record<string, unknown>,
  boardId: string,
  userId: string
): Promise<ToolExecutionResult> {
  await assertBoardNotFull(boardId);
  const id = uuidv4();
  const now = new Date();
  const object: Record<string, unknown> = {
    id,
    type: 'frame',
    title: input.title as string,
    x: input.x as number,
    y: input.y as number,
    width: input.width as number,
    height: input.height as number,
    color: (input.color as string) || AI_COLORS.FRAME_DEFAULT,
    locked: false,
    frameId: null,
    createdBy: userId,
    lastEditedBy: userId,
    createdVia: 'ai',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await boardService.addObjectInRedis(boardId, object);

  const payload: ObjectCreatedPayload = {
    boardId,
    object: object as unknown as BoardObject,
    userId: AI_BROADCAST_USER_ID,
    timestamp: Date.now(),
  };
  trackedEmit(getIO().to(boardId), WebSocketEvent.OBJECT_CREATED, payload);

  return {
    output: {
      objectId: id,
      success: true,
      type: 'frame',
      message: `Created frame '${input.title}' at (${input.x}, ${input.y}), size ${input.width}x${input.height}`,
    },
    operation: {
      type: 'create',
      objectType: 'frame',
      objectId: id,
      details: { title: input.title, x: input.x, y: input.y, width: input.width, height: input.height },
    },
  };
}

async function executeCreateConnector(
  input: Record<string, unknown>,
  boardId: string,
  userId: string
): Promise<ToolExecutionResult> {
  await assertBoardNotFull(boardId);
  const id = uuidv4();
  const now = new Date();
  const fromId = input.fromObjectId as string;
  const toId = input.toObjectId as string;

  // Look up positions of source and target objects
  const cachedState = await boardService.getOrLoadBoardState(boardId);
  const fromObj = getObjectById(cachedState.objects, fromId);
  const toObj = getObjectById(cachedState.objects, toId);

  if (!fromObj) {
    return {
      output: { objectId: '', success: false, error: `Source object ${fromId} not found` },
      operation: { type: 'create', objectType: 'connector', objectId: '', details: { error: 'Source not found' } },
    };
  }
  if (!toObj) {
    return {
      output: { objectId: '', success: false, error: `Target object ${toId} not found` },
      operation: { type: 'create', objectType: 'connector', objectId: '', details: { error: 'Target not found' } },
    };
  }

  // Use center of source and target for connector endpoints
  const fromWidth = 'width' in fromObj ? (fromObj as { width: number }).width : 0;
  const fromHeight = 'height' in fromObj ? (fromObj as { height: number }).height : 0;
  const toWidth = 'width' in toObj ? (toObj as { width: number }).width : 0;
  const toHeight = 'height' in toObj ? (toObj as { height: number }).height : 0;

  const object: Record<string, unknown> = {
    id,
    type: 'connector',
    fromObjectId: fromId,
    toObjectId: toId,
    style: (input.style as string) || 'arrow',
    color: (input.color as string) || AI_COLORS.CONNECTOR_DEFAULT,
    x: fromObj.x + fromWidth / 2,
    y: fromObj.y + fromHeight / 2,
    x2: toObj.x + toWidth / 2,
    y2: toObj.y + toHeight / 2,
    frameId: null,
    createdBy: userId,
    lastEditedBy: userId,
    createdVia: 'ai',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await boardService.addObjectInRedis(boardId, object);

  const payload: ObjectCreatedPayload = {
    boardId,
    object: object as unknown as BoardObject,
    userId: AI_BROADCAST_USER_ID,
    timestamp: Date.now(),
  };
  trackedEmit(getIO().to(boardId), WebSocketEvent.OBJECT_CREATED, payload);

  return {
    output: {
      objectId: id,
      success: true,
      type: 'connector',
      message: `Created ${input.style || 'arrow'} connector from ${fromId} to ${toId}`,
    },
    operation: {
      type: 'create',
      objectType: 'connector',
      objectId: id,
      details: { fromObjectId: fromId, toObjectId: toId, style: input.style || 'arrow' },
    },
  };
}

async function executeCreateTextElement(
  input: Record<string, unknown>,
  boardId: string,
  userId: string
): Promise<ToolExecutionResult> {
  await assertBoardNotFull(boardId);
  const id = uuidv4();
  const now = new Date();
  const object: Record<string, unknown> = {
    id,
    type: 'text',
    text: input.text as string,
    x: input.x as number,
    y: input.y as number,
    fontSize: (input.fontSize as number) || 16,
    color: (input.color as string) || AI_COLORS.TEXT_DEFAULT,
    frameId: null,
    createdBy: userId,
    lastEditedBy: userId,
    createdVia: 'ai',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await boardService.addObjectInRedis(boardId, object);

  const payload: ObjectCreatedPayload = {
    boardId,
    object: object as unknown as BoardObject,
    userId: AI_BROADCAST_USER_ID,
    timestamp: Date.now(),
  };
  trackedEmit(getIO().to(boardId), WebSocketEvent.OBJECT_CREATED, payload);

  return {
    output: {
      objectId: id,
      success: true,
      type: 'text',
      message: `Created text '${(input.text as string).slice(0, 40)}' at (${input.x}, ${input.y})`,
    },
    operation: {
      type: 'create',
      objectType: 'text',
      objectId: id,
      details: { text: input.text, x: input.x, y: input.y },
    },
  };
}

async function executeCreateLine(
  input: Record<string, unknown>,
  boardId: string,
  userId: string
): Promise<ToolExecutionResult> {
  await assertBoardNotFull(boardId);
  const id = uuidv4();
  const now = new Date();
  const object: Record<string, unknown> = {
    id,
    type: 'line',
    x: input.x as number,
    y: input.y as number,
    x2: input.x2 as number,
    y2: input.y2 as number,
    color: (input.color as string) || '#757575',
    endpointStyle: (input.endpointStyle as string) || 'none',
    strokePattern: (input.strokePattern as string) || 'solid',
    strokeWeight: (input.strokeWeight as string) || 'normal',
    frameId: null,
    createdBy: userId,
    lastEditedBy: userId,
    createdVia: 'ai',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await boardService.addObjectInRedis(boardId, object);

  const payload: ObjectCreatedPayload = {
    boardId,
    object: object as unknown as BoardObject,
    userId: AI_BROADCAST_USER_ID,
    timestamp: Date.now(),
  };
  trackedEmit(getIO().to(boardId), WebSocketEvent.OBJECT_CREATED, payload);

  return {
    output: {
      objectId: id,
      success: true,
      type: 'line',
      message: `Created line from (${input.x}, ${input.y}) to (${input.x2}, ${input.y2})`,
    },
    operation: {
      type: 'create',
      objectType: 'line',
      objectId: id,
      details: { x: input.x, y: input.y, x2: input.x2, y2: input.y2 },
    },
  };
}

// ─── Manipulation Tools ───────────────────────────────────────

async function executeMoveObject(
  input: Record<string, unknown>,
  boardId: string,
  userId: string
): Promise<ToolExecutionResult> {
  const objectId = input.objectId as string;
  const updates = {
    x: input.x as number,
    y: input.y as number,
    lastEditedBy: userId,
    updatedAt: new Date().toISOString(),
  };

  await boardService.updateObjectInRedis(boardId, objectId, updates);

  const payload: ObjectUpdatedPayload = {
    boardId,
    objectId,
    updates: updates as unknown as ObjectUpdatedPayload['updates'],
    userId: AI_BROADCAST_USER_ID,
    timestamp: Date.now(),
  };
  trackedEmit(getIO().to(boardId), WebSocketEvent.OBJECT_UPDATED, payload);

  return {
    output: { objectId, success: true, message: `Moved object to (${input.x}, ${input.y})` },
    operation: {
      type: 'update',
      objectType: undefined,
      objectId,
      details: { x: input.x, y: input.y },
    },
  };
}

async function executeResizeObject(
  input: Record<string, unknown>,
  boardId: string,
  userId: string
): Promise<ToolExecutionResult> {
  const objectId = input.objectId as string;
  const updates = {
    width: input.width as number,
    height: input.height as number,
    lastEditedBy: userId,
    updatedAt: new Date().toISOString(),
  };

  await boardService.updateObjectInRedis(boardId, objectId, updates);

  const payload: ObjectUpdatedPayload = {
    boardId,
    objectId,
    updates: updates as unknown as ObjectUpdatedPayload['updates'],
    userId: AI_BROADCAST_USER_ID,
    timestamp: Date.now(),
  };
  trackedEmit(getIO().to(boardId), WebSocketEvent.OBJECT_UPDATED, payload);

  return {
    output: { objectId, success: true, message: `Resized to ${input.width}x${input.height}` },
    operation: {
      type: 'update',
      objectType: undefined,
      objectId,
      details: { width: input.width, height: input.height },
    },
  };
}

async function executeUpdateText(
  input: Record<string, unknown>,
  boardId: string,
  userId: string
): Promise<ToolExecutionResult> {
  const objectId = input.objectId as string;
  const updates = {
    text: input.newText as string,
    lastEditedBy: userId,
    updatedAt: new Date().toISOString(),
  };

  await boardService.updateObjectInRedis(boardId, objectId, updates);

  const payload: ObjectUpdatedPayload = {
    boardId,
    objectId,
    updates: updates as unknown as ObjectUpdatedPayload['updates'],
    userId: AI_BROADCAST_USER_ID,
    timestamp: Date.now(),
  };
  trackedEmit(getIO().to(boardId), WebSocketEvent.OBJECT_UPDATED, payload);

  return {
    output: { objectId, success: true, message: `Updated text to '${(input.newText as string).slice(0, 40)}'` },
    operation: {
      type: 'update',
      objectType: undefined,
      objectId,
      details: { newText: input.newText },
    },
  };
}

async function executeChangeColor(
  input: Record<string, unknown>,
  boardId: string,
  userId: string
): Promise<ToolExecutionResult> {
  const objectId = input.objectId as string;
  const updates = {
    color: input.color as string,
    lastEditedBy: userId,
    updatedAt: new Date().toISOString(),
  };

  await boardService.updateObjectInRedis(boardId, objectId, updates);

  const payload: ObjectUpdatedPayload = {
    boardId,
    objectId,
    updates: updates as unknown as ObjectUpdatedPayload['updates'],
    userId: AI_BROADCAST_USER_ID,
    timestamp: Date.now(),
  };
  trackedEmit(getIO().to(boardId), WebSocketEvent.OBJECT_UPDATED, payload);

  return {
    output: { objectId, success: true, message: `Changed color to ${input.color}` },
    operation: {
      type: 'update',
      objectType: undefined,
      objectId,
      details: { color: input.color },
    },
  };
}

async function executeDeleteObject(
  input: Record<string, unknown>,
  boardId: string,
  userId: string
): Promise<ToolExecutionResult> {
  const objectId = input.objectId as string;

  await boardService.removeObjectFromRedis(boardId, objectId);

  const payload: ObjectDeletedPayload = {
    boardId,
    objectId,
    userId: AI_BROADCAST_USER_ID,
    timestamp: Date.now(),
  };
  trackedEmit(getIO().to(boardId), WebSocketEvent.OBJECT_DELETED, payload);

  return {
    output: { objectId, success: true, message: `Deleted object ${objectId}` },
    operation: {
      type: 'delete',
      objectType: undefined,
      objectId,
      details: {},
    },
  };
}

// ─── Read Tools ───────────────────────────────────────────────

async function executeGetViewportObjects(
  input: Record<string, unknown>,
  boardId: string,
  _userId: string,
  viewport: ViewportBounds
): Promise<ToolExecutionResult> {
  const cachedState = await boardService.getOrLoadBoardState(boardId);

  const filtered = getViewportFilteredObjects(cachedState.objects, viewport, {
    filterByType: input.filterByType as string | undefined,
    filterByColor: input.filterByColor as string | undefined,
  });

  const summaries = filtered.map(summarizeObject);

  return {
    output: {
      success: true,
      objectCount: summaries.length,
      objects: summaries,
      message: `Found ${summaries.length} objects in viewport`,
    },
    operation: {
      type: 'read',
      objectType: (input.filterByType as string) || undefined,
      objectId: 'viewport',
      details: { count: summaries.length },
    },
  };
}

async function executeGetObjectDetails(
  input: Record<string, unknown>,
  boardId: string,
  _userId: string,
  _viewport: ViewportBounds
): Promise<ToolExecutionResult> {
  const objectId = input.objectId as string;
  const cachedState = await boardService.getOrLoadBoardState(boardId);
  const obj = getObjectById(cachedState.objects, objectId);

  if (!obj) {
    return {
      output: { success: false, error: `Object ${objectId} not found` },
      operation: {
        type: 'read',
        objectId,
        details: { error: 'not found' },
      },
    };
  }

  return {
    output: {
      success: true,
      object: summarizeObject(obj),
      message: `Details for ${obj.type} object ${objectId}`,
    },
    operation: {
      type: 'read',
      objectType: obj.type,
      objectId,
      details: {},
    },
  };
}

// ─── Batch Tools ──────────────────────────────────────────────

async function executeBatchUpdateByFilter(
  input: Record<string, unknown>,
  boardId: string,
  userId: string,
  viewport: ViewportBounds
): Promise<ToolExecutionResult> {
  const updates = input.updates as Record<string, unknown> | undefined;
  if (!updates) {
    return {
      output: { success: false, error: 'Missing updates object' },
      operation: { type: 'batch_update', objectId: 'batch', details: { error: 'Missing updates' } },
    };
  }

  const cachedState = await boardService.getOrLoadBoardState(boardId);
  const viewportOnly = input.viewportOnly !== false; // default true

  // Start with all objects, optionally filter to viewport
  let candidates = viewportOnly
    ? cachedState.objects.filter(obj => isObjectInViewport(obj, viewport))
    : [...cachedState.objects];

  // Apply filters
  if (input.filterByType) {
    candidates = candidates.filter(obj => obj.type === input.filterByType);
  }
  if (input.filterByColor) {
    const targetColor = (input.filterByColor as string).toUpperCase();
    candidates = candidates.filter(obj =>
      'color' in obj && (obj as { color: string }).color.toUpperCase() === targetColor
    );
  }
  if (input.filterByFrameId) {
    candidates = candidates.filter(obj => obj.frameId === input.filterByFrameId);
  }

  if (candidates.length === 0) {
    return {
      output: { success: true, affectedCount: 0, message: 'No matching objects found' },
      operation: { type: 'batch_update', objectId: 'batch', details: { affectedCount: 0 }, count: 0 },
    };
  }

  // Apply updates to each matching object in the full cached state
  const now = new Date().toISOString();
  const affectedIds: string[] = [];
  const batchUpdates: Array<{ objectId: string; [key: string]: unknown }> = [];

  for (const candidate of candidates) {
    const idx = cachedState.objects.findIndex(o => o.id === candidate.id);
    if (idx === -1) continue;

    const objUpdates: Record<string, unknown> = {
      lastEditedBy: userId,
      updatedAt: now,
    };

    // Color: absolute
    if (updates.color) {
      objUpdates.color = updates.color;
    }

    // x/y: relative offsets
    if (typeof updates.x === 'number') {
      objUpdates.x = cachedState.objects[idx].x + (updates.x as number);
    }
    if (typeof updates.y === 'number') {
      objUpdates.y = cachedState.objects[idx].y + (updates.y as number);
    }

    cachedState.objects[idx] = {
      ...cachedState.objects[idx],
      ...objUpdates,
    } as typeof cachedState.objects[number];

    affectedIds.push(candidate.id);
    batchUpdates.push({ objectId: candidate.id, ...objUpdates });
  }

  // Single Redis write
  await boardService.saveBoardStateToRedis(boardId, cachedState);

  // Broadcast individual updates for each affected object.
  // This reuses the existing OBJECT_UPDATED event so all frontend
  // reconciliation logic works unchanged.
  for (const upd of batchUpdates) {
    const { objectId, ...rest } = upd;
    const payload: ObjectUpdatedPayload = {
      boardId,
      objectId: objectId as string,
      updates: rest as unknown as ObjectUpdatedPayload['updates'],
      userId: AI_BROADCAST_USER_ID,
      timestamp: Date.now(),
    };
    trackedEmit(getIO().to(boardId), WebSocketEvent.OBJECT_UPDATED, payload);
  }

  return {
    output: {
      success: true,
      affectedCount: affectedIds.length,
      affectedIds,
      message: `Updated ${affectedIds.length} objects`,
    },
    operation: {
      type: 'batch_update',
      objectId: 'batch',
      details: {
        affectedCount: affectedIds.length,
        filters: {
          type: input.filterByType,
          color: input.filterByColor,
          frameId: input.filterByFrameId,
        },
        updates,
      },
      count: affectedIds.length,
    },
  };
}

// ============================================================
// Main Executor — Route tool calls to implementations
// ============================================================

export const toolExecutor = {
  /**
   * Execute a single tool call and return the result.
   * This is the bridge between the AI agent loop and boardService.
   */
  async execute(
    toolName: string,
    input: unknown,
    boardId: string,
    userId: string,
    viewport: ViewportBounds
  ): Promise<ToolExecutionResult> {
    const typedInput = input as Record<string, unknown>;

    try {
      switch (toolName as AIToolName) {
        // Creation tools
        case 'createStickyNote':
          return await executeCreateStickyNote(typedInput, boardId, userId);
        case 'createShape':
          return await executeCreateShape(typedInput, boardId, userId);
        case 'createFrame':
          return await executeCreateFrame(typedInput, boardId, userId);
        case 'createConnector':
          return await executeCreateConnector(typedInput, boardId, userId);
        case 'createLine':
          return await executeCreateLine(typedInput, boardId, userId);
        case 'createTextElement':
          return await executeCreateTextElement(typedInput, boardId, userId);

        // Manipulation tools
        case 'moveObject':
          return await executeMoveObject(typedInput, boardId, userId);
        case 'resizeObject':
          return await executeResizeObject(typedInput, boardId, userId);
        case 'updateText':
          return await executeUpdateText(typedInput, boardId, userId);
        case 'changeColor':
          return await executeChangeColor(typedInput, boardId, userId);
        case 'deleteObject':
          return await executeDeleteObject(typedInput, boardId, userId);

        // Read tools
        case 'getViewportObjects':
          return await executeGetViewportObjects(typedInput, boardId, userId, viewport);
        case 'getObjectDetails':
          return await executeGetObjectDetails(typedInput, boardId, userId, viewport);

        // Batch tools
        case 'batchUpdateByFilter':
          return await executeBatchUpdateByFilter(typedInput, boardId, userId, viewport);

        default:
          logger.error(`Unknown AI tool: ${toolName}`);
          return {
            output: { success: false, error: `Unknown tool: ${toolName}` },
            operation: { type: 'read', objectId: '', details: { error: `Unknown tool: ${toolName}` } },
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tool execution failed';
      logger.error(`AI tool ${toolName} failed: ${message}`);
      return {
        output: { success: false, error: message },
        operation: {
          type: 'read',
          objectId: '',
          details: { error: message, tool: toolName },
        },
      };
    }
  },
};
