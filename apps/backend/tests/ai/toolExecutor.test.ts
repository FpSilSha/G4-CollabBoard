/**
 * Unit tests for toolExecutor — the bridge between AI tool calls and boardService.
 *
 * Strategy:
 * - Mock boardService entirely so no Redis/Postgres calls happen.
 * - Mock wsMetrics.trackedEmit so we can assert which WS events are emitted.
 * - Mock teleportFlagService for the createFlag tool.
 * - Mock metricsService to satisfy trackedEmit's internal incrementWsEventOut call.
 * - The global setup.ts already mocks: logger, @anthropic-ai/sdk, websocket/server.
 *
 * Each tool group gets 2-3 meaningful tests:
 *   1. Happy path — correct boardService call + correct WS event + operation shape
 *   2. boardService error — error captured in operation, does NOT throw
 *   3. Tool-specific edge case (validation, object-not-found, defaults, etc.)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Module mocks (must come before imports that use them) ────────────────────

vi.mock('../../src/services/boardService', () => ({
  boardService: {
    getBoardStateFromRedis: vi.fn(),
    getOrLoadBoardState: vi.fn(),
    saveBoardStateToRedis: vi.fn(),
    addObjectInRedis: vi.fn(),
    updateObjectInRedis: vi.fn(),
    removeObjectFromRedis: vi.fn(),
  },
}));

vi.mock('../../src/services/teleportFlagService', () => ({
  teleportFlagService: {
    createFlag: vi.fn(),
  },
}));

vi.mock('../../src/services/metricsService', () => ({
  metricsService: {
    incrementWsEventOut: vi.fn(),
    incrementWsEventIn: vi.fn(),
    recordAICommand: vi.fn(),
  },
}));

vi.mock('../../src/websocket/wsMetrics', () => ({
  trackedEmit: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { toolExecutor } from '../../src/ai/toolExecutor';
import { boardService } from '../../src/services/boardService';
import { teleportFlagService } from '../../src/services/teleportFlagService';
import { trackedEmit } from '../../src/websocket/wsMetrics';
import { makeBoardObject, makeCachedBoardState } from '../mocks/factories';

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const BOARD_ID = 'board-test-123';
const USER_ID = 'user-abc';

/** Viewport that covers the entire board — all objects are "in viewport". */
const FULL_VIEWPORT = { x: 0, y: 0, width: 10000, height: 10000 };

/** Minimal viewport that captures nothing. */
const EMPTY_VIEWPORT = { x: 99999, y: 99999, width: 100, height: 100 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a non-full board state (0 objects — under the 2000 object cap). */
function mockEmptyBoardState() {
  const state = makeCachedBoardState({ boardId: BOARD_ID, objects: [] });
  vi.mocked(boardService.getBoardStateFromRedis).mockResolvedValue(state as never);
  vi.mocked(boardService.getOrLoadBoardState).mockResolvedValue(state as never);
  return state;
}

/** Returns a board state populated with the given objects. */
function mockBoardStateWithObjects(objects: ReturnType<typeof makeBoardObject>[]) {
  const state = makeCachedBoardState({ boardId: BOARD_ID, objects });
  vi.mocked(boardService.getBoardStateFromRedis).mockResolvedValue(state as never);
  vi.mocked(boardService.getOrLoadBoardState).mockResolvedValue(state as never);
  return state;
}

/** Returns a "board full" state (2000 objects). */
function mockFullBoardState() {
  const objects = Array.from({ length: 2000 }, () => makeBoardObject());
  const state = makeCachedBoardState({ boardId: BOARD_ID, objects });
  vi.mocked(boardService.getBoardStateFromRedis).mockResolvedValue(state as never);
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// createStickyNote
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — createStickyNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.addObjectInRedis).mockResolvedValue(undefined);
  });

  it('happy path: calls addObjectInRedis with correct shape and emits object:created', async () => {
    mockEmptyBoardState();

    const result = await toolExecutor.execute(
      'createStickyNote',
      { text: 'Hello world', x: 100, y: 200 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    // boardService was called
    expect(boardService.addObjectInRedis).toHaveBeenCalledOnce();
    const [calledBoardId, calledObj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(calledBoardId).toBe(BOARD_ID);
    expect(calledObj).toMatchObject({
      type: 'sticky',
      text: 'Hello world',
      x: 100,
      y: 200,
      createdBy: USER_ID,
      createdVia: 'ai',
    });
    expect(typeof calledObj.id).toBe('string');
    expect((calledObj.id as string).length).toBeGreaterThan(0);

    // WS event emitted
    expect(trackedEmit).toHaveBeenCalledOnce();
    const emitArgs = vi.mocked(trackedEmit).mock.calls[0];
    expect(emitArgs[1]).toBe('object:created');

    // Operation record shape
    expect(result.operation.type).toBe('create');
    expect(result.operation.objectType).toBe('sticky');
    expect(typeof result.operation.objectId).toBe('string');
    expect(result.output.success).toBe(true);
  });

  it('uses default yellow color and medium size preset when not specified', async () => {
    mockEmptyBoardState();

    await toolExecutor.execute(
      'createStickyNote',
      { text: 'Default colors', x: 0, y: 0 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    const [, calledObj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(calledObj.color).toBe('#FFEB3B'); // AI_COLORS.STICKY_YELLOW
    expect(calledObj.width).toBe(200);       // medium preset width
    expect(calledObj.height).toBe(200);      // medium preset height
  });

  it('truncates text that exceeds the size preset char limit', async () => {
    mockEmptyBoardState();

    const longText = 'A'.repeat(600); // exceeds large preset (500 chars)
    await toolExecutor.execute(
      'createStickyNote',
      { text: longText, x: 0, y: 0, size: 'large' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    const [, calledObj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect((calledObj.text as string).length).toBeLessThanOrEqual(500);
  });

  it('returns error operation when board is full (2000 objects)', async () => {
    mockFullBoardState();

    const result = await toolExecutor.execute(
      'createStickyNote',
      { text: 'Too many', x: 0, y: 0 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toMatch(/maximum/i);
    expect(boardService.addObjectInRedis).not.toHaveBeenCalled();
    expect(trackedEmit).not.toHaveBeenCalled();
  });

  it('captures boardService error without throwing', async () => {
    mockEmptyBoardState();
    vi.mocked(boardService.addObjectInRedis).mockRejectedValue(new Error('Redis down'));

    const result = await toolExecutor.execute(
      'createStickyNote',
      { text: 'Will fail', x: 0, y: 0 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain('Redis down');
    expect(trackedEmit).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createShape
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — createShape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.addObjectInRedis).mockResolvedValue(undefined);
  });

  it('happy path: creates shape and emits object:created', async () => {
    mockEmptyBoardState();

    const result = await toolExecutor.execute(
      'createShape',
      { shapeType: 'rectangle', x: 50, y: 50, width: 200, height: 100 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(boardService.addObjectInRedis).toHaveBeenCalledOnce();
    const [, obj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(obj).toMatchObject({
      type: 'shape',
      shapeType: 'rectangle',
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      createdVia: 'ai',
    });

    expect(trackedEmit).toHaveBeenCalledOnce();
    expect(vi.mocked(trackedEmit).mock.calls[0][1]).toBe('object:created');

    expect(result.operation.type).toBe('create');
    expect(result.operation.objectType).toBe('shape');
    expect(result.output.success).toBe(true);
  });

  it('uses default grey color when not specified', async () => {
    mockEmptyBoardState();

    await toolExecutor.execute(
      'createShape',
      { shapeType: 'circle', x: 0, y: 0, width: 100, height: 100 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    const [, obj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(obj.color).toBe('#E0E0E0');
    expect(obj.rotation).toBe(0);
  });

  it('captures boardService error without throwing', async () => {
    mockEmptyBoardState();
    vi.mocked(boardService.addObjectInRedis).mockRejectedValue(new Error('Service unavailable'));

    const result = await toolExecutor.execute(
      'createShape',
      { shapeType: 'circle', x: 0, y: 0, width: 100, height: 100 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain('Service unavailable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createFrame
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — createFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.addObjectInRedis).mockResolvedValue(undefined);
    vi.mocked(boardService.saveBoardStateToRedis).mockResolvedValue(undefined);
  });

  it('happy path: creates frame without parent and emits object:created', async () => {
    mockEmptyBoardState();

    const result = await toolExecutor.execute(
      'createFrame',
      { title: 'Sprint 1', x: 10, y: 10, width: 400, height: 300 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(boardService.addObjectInRedis).toHaveBeenCalledOnce();
    const [, obj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(obj).toMatchObject({
      type: 'frame',
      title: 'Sprint 1',
      x: 10,
      y: 10,
      width: 400,
      height: 300,
      frameId: null,
      createdVia: 'ai',
    });

    expect(trackedEmit).toHaveBeenCalledOnce();
    expect(vi.mocked(trackedEmit).mock.calls[0][1]).toBe('object:created');
    expect(result.operation.type).toBe('create');
    expect(result.operation.objectType).toBe('frame');
    expect(result.output.success).toBe(true);
  });

  it('rejects nesting when parentFrameId does not exist on the board', async () => {
    mockEmptyBoardState(); // board has no objects

    const result = await toolExecutor.execute(
      'createFrame',
      { title: 'Child', x: 0, y: 0, width: 100, height: 100, parentFrameId: 'nonexistent-frame' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toMatch(/not found/i);
    expect(boardService.addObjectInRedis).not.toHaveBeenCalled();
  });

  it('rejects nesting when parentFrameId points to a non-frame object', async () => {
    const stickyObj = makeBoardObject({ id: 'sticky-1', type: 'sticky' });
    mockBoardStateWithObjects([stickyObj]);

    const result = await toolExecutor.execute(
      'createFrame',
      { title: 'Child', x: 0, y: 0, width: 100, height: 100, parentFrameId: 'sticky-1' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toMatch(/not a frame/i);
    expect(boardService.addObjectInRedis).not.toHaveBeenCalled();
  });

  it('creates nested frame when parentFrameId points to a valid top-level frame', async () => {
    const parentFrame = makeBoardObject({ id: 'frame-parent', type: 'frame', frameId: null }) as
      ReturnType<typeof makeBoardObject> & { type: 'frame'; frameId: null };
    mockBoardStateWithObjects([parentFrame]);

    const result = await toolExecutor.execute(
      'createFrame',
      { title: 'Child Frame', x: 0, y: 0, width: 100, height: 100, parentFrameId: 'frame-parent' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(true);
    expect(result.output.parentFrameId).toBe('frame-parent');
    expect(boardService.addObjectInRedis).toHaveBeenCalledOnce();
    const [, obj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(obj.frameId).toBe('frame-parent');
  });

  it('rejects double-nesting (parentFrame is itself already a child)', async () => {
    // parentFrame has frameId set — it IS already nested inside another frame
    const alreadyNestedFrame = makeBoardObject({
      id: 'frame-nested',
      type: 'frame',
      frameId: 'some-grandparent',
    });
    mockBoardStateWithObjects([alreadyNestedFrame]);

    const result = await toolExecutor.execute(
      'createFrame',
      { title: 'Too Deep', x: 0, y: 0, width: 100, height: 100, parentFrameId: 'frame-nested' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toMatch(/nesting/i);
    expect(boardService.addObjectInRedis).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createConnector
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — createConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.addObjectInRedis).mockResolvedValue(undefined);
  });

  it('happy path: creates connector between two existing objects', async () => {
    const from = makeBoardObject({ id: 'obj-from', x: 0, y: 0, width: 100, height: 100 });
    const to = makeBoardObject({ id: 'obj-to', x: 300, y: 300, width: 100, height: 100 });
    mockBoardStateWithObjects([from, to]);

    const result = await toolExecutor.execute(
      'createConnector',
      { fromObjectId: 'obj-from', toObjectId: 'obj-to' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(boardService.addObjectInRedis).toHaveBeenCalledOnce();
    const [, obj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(obj).toMatchObject({
      type: 'connector',
      fromObjectId: 'obj-from',
      toObjectId: 'obj-to',
      createdVia: 'ai',
    });

    expect(trackedEmit).toHaveBeenCalledOnce();
    expect(vi.mocked(trackedEmit).mock.calls[0][1]).toBe('object:created');
    expect(result.output.success).toBe(true);
    expect(result.operation.type).toBe('create');
    expect(result.operation.objectType).toBe('connector');
  });

  it('returns error when source object is not found', async () => {
    const to = makeBoardObject({ id: 'obj-to' });
    mockBoardStateWithObjects([to]);

    const result = await toolExecutor.execute(
      'createConnector',
      { fromObjectId: 'missing', toObjectId: 'obj-to' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toMatch(/source.*not found/i);
    expect(boardService.addObjectInRedis).not.toHaveBeenCalled();
  });

  it('returns error when target object is not found', async () => {
    const from = makeBoardObject({ id: 'obj-from' });
    mockBoardStateWithObjects([from]);

    const result = await toolExecutor.execute(
      'createConnector',
      { fromObjectId: 'obj-from', toObjectId: 'missing' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toMatch(/target.*not found/i);
    expect(boardService.addObjectInRedis).not.toHaveBeenCalled();
  });

  it('connector endpoints are computed from centers of source/target', async () => {
    const from = makeBoardObject({ id: 'from', x: 0, y: 0, width: 100, height: 100 });
    const to = makeBoardObject({ id: 'to', x: 200, y: 200, width: 100, height: 100 });
    mockBoardStateWithObjects([from, to]);

    await toolExecutor.execute(
      'createConnector',
      { fromObjectId: 'from', toObjectId: 'to' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    const [, obj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(obj.x).toBe(50);   // center of from: 0 + 100/2
    expect(obj.y).toBe(50);
    expect(obj.x2).toBe(250); // center of to: 200 + 100/2
    expect(obj.y2).toBe(250);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createTextElement
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — createTextElement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.addObjectInRedis).mockResolvedValue(undefined);
  });

  it('happy path: creates text element and emits object:created', async () => {
    mockEmptyBoardState();

    const result = await toolExecutor.execute(
      'createTextElement',
      { text: 'Project Title', x: 50, y: 50 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(boardService.addObjectInRedis).toHaveBeenCalledOnce();
    const [, obj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(obj).toMatchObject({
      type: 'text',
      text: 'Project Title',
      x: 50,
      y: 50,
      createdVia: 'ai',
    });

    expect(trackedEmit).toHaveBeenCalledOnce();
    expect(vi.mocked(trackedEmit).mock.calls[0][1]).toBe('object:created');
    expect(result.operation.type).toBe('create');
    expect(result.operation.objectType).toBe('text');
    expect(result.output.success).toBe(true);
  });

  it('applies default fontSize and color when not specified', async () => {
    mockEmptyBoardState();

    await toolExecutor.execute(
      'createTextElement',
      { text: 'Defaults', x: 0, y: 0 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    const [, obj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(obj.fontSize).toBe(16);
    expect(obj.color).toBe('#212121'); // AI_COLORS.TEXT_DEFAULT
  });

  it('respects custom fontSize and color when specified', async () => {
    mockEmptyBoardState();

    await toolExecutor.execute(
      'createTextElement',
      { text: 'Big Red', x: 0, y: 0, fontSize: 32, color: '#FF0000' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    const [, obj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(obj.fontSize).toBe(32);
    expect(obj.color).toBe('#FF0000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createLine
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — createLine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.addObjectInRedis).mockResolvedValue(undefined);
  });

  it('happy path: creates line and emits object:created', async () => {
    mockEmptyBoardState();

    const result = await toolExecutor.execute(
      'createLine',
      { x: 0, y: 0, x2: 100, y2: 100 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(boardService.addObjectInRedis).toHaveBeenCalledOnce();
    const [, obj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(obj).toMatchObject({
      type: 'line',
      x: 0,
      y: 0,
      x2: 100,
      y2: 100,
      createdVia: 'ai',
    });

    expect(trackedEmit).toHaveBeenCalledOnce();
    expect(vi.mocked(trackedEmit).mock.calls[0][1]).toBe('object:created');
    expect(result.operation.type).toBe('create');
    expect(result.operation.objectType).toBe('line');
    expect(result.output.success).toBe(true);
  });

  it('applies default color, endpointStyle, strokePattern, strokeWeight', async () => {
    mockEmptyBoardState();

    await toolExecutor.execute(
      'createLine',
      { x: 0, y: 0, x2: 100, y2: 100 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    const [, obj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(obj.color).toBe('#757575');
    expect(obj.endpointStyle).toBe('none');
    expect(obj.strokePattern).toBe('solid');
    expect(obj.strokeWeight).toBe('normal');
  });

  it('captures boardService error without throwing', async () => {
    mockEmptyBoardState();
    vi.mocked(boardService.addObjectInRedis).mockRejectedValue(new Error('Write failed'));

    const result = await toolExecutor.execute(
      'createLine',
      { x: 0, y: 0, x2: 50, y2: 50 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain('Write failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createFlag
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — createFlag', () => {
  const mockFlag = {
    id: 'flag-123',
    boardId: BOARD_ID,
    label: 'Important Zone',
    x: 100,
    y: 200,
    color: '#E6194B',
    createdBy: USER_ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(teleportFlagService.createFlag).mockResolvedValue(mockFlag as never);
  });

  it('happy path: calls teleportFlagService and emits flag:created', async () => {
    const result = await toolExecutor.execute(
      'createFlag',
      { label: 'Important Zone', x: 100, y: 200 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(teleportFlagService.createFlag).toHaveBeenCalledOnce();
    const [calledBoardId, calledUserId, calledData] = vi.mocked(teleportFlagService.createFlag).mock.calls[0];
    expect(calledBoardId).toBe(BOARD_ID);
    expect(calledUserId).toBe(USER_ID);
    expect(calledData).toMatchObject({ label: 'Important Zone', x: 100, y: 200 });

    expect(trackedEmit).toHaveBeenCalledOnce();
    expect(vi.mocked(trackedEmit).mock.calls[0][1]).toBe('flag:created');

    expect(result.output.success).toBe(true);
    expect(result.output.flagId).toBe('flag-123');
    expect(result.operation.type).toBe('create');
    expect(result.operation.objectType).toBe('flag');
  });

  it('assigns a deterministic color from palette when color not specified', async () => {
    await toolExecutor.execute(
      'createFlag',
      { label: 'Test', x: 0, y: 0 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    const [, , calledData] = vi.mocked(teleportFlagService.createFlag).mock.calls[0];
    // Should be one of the FLAG_COLORS palette entries
    const FLAG_COLORS = [
      '#E6194B', '#3CB44B', '#4363D8', '#FFE119',
      '#F58231', '#911EB4', '#42D4F4', '#F032E6',
    ];
    expect(FLAG_COLORS).toContain(calledData.color);
  });

  it('captures teleportFlagService error without throwing', async () => {
    vi.mocked(teleportFlagService.createFlag).mockRejectedValue(new Error('DB error'));

    const result = await toolExecutor.execute(
      'createFlag',
      { label: 'Fail', x: 0, y: 0 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain('DB error');
    expect(trackedEmit).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// moveObject
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — moveObject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.updateObjectInRedis).mockResolvedValue(undefined);
  });

  it('happy path: calls updateObjectInRedis with x/y and emits object:updated', async () => {
    const result = await toolExecutor.execute(
      'moveObject',
      { objectId: 'obj-1', x: 300, y: 400 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(boardService.updateObjectInRedis).toHaveBeenCalledOnce();
    const [calledBoardId, calledObjId, updates] = vi.mocked(boardService.updateObjectInRedis).mock.calls[0];
    expect(calledBoardId).toBe(BOARD_ID);
    expect(calledObjId).toBe('obj-1');
    expect(updates).toMatchObject({ x: 300, y: 400, lastEditedBy: USER_ID });

    expect(trackedEmit).toHaveBeenCalledOnce();
    expect(vi.mocked(trackedEmit).mock.calls[0][1]).toBe('object:updated');

    expect(result.operation.type).toBe('update');
    expect(result.operation.objectId).toBe('obj-1');
    expect(result.output.success).toBe(true);
  });

  it('captures boardService error without throwing', async () => {
    vi.mocked(boardService.updateObjectInRedis).mockRejectedValue(new Error('Object not found in Redis'));

    const result = await toolExecutor.execute(
      'moveObject',
      { objectId: 'ghost', x: 0, y: 0 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain('Object not found in Redis');
    expect(trackedEmit).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resizeObject
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — resizeObject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.updateObjectInRedis).mockResolvedValue(undefined);
  });

  it('happy path: calls updateObjectInRedis with width/height and emits object:updated', async () => {
    const result = await toolExecutor.execute(
      'resizeObject',
      { objectId: 'obj-2', width: 400, height: 300 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(boardService.updateObjectInRedis).toHaveBeenCalledOnce();
    const [, , updates] = vi.mocked(boardService.updateObjectInRedis).mock.calls[0];
    expect(updates).toMatchObject({ width: 400, height: 300, lastEditedBy: USER_ID });

    expect(trackedEmit).toHaveBeenCalledOnce();
    expect(vi.mocked(trackedEmit).mock.calls[0][1]).toBe('object:updated');

    expect(result.operation.type).toBe('update');
    expect(result.output.success).toBe(true);
  });

  it('captures boardService error without throwing', async () => {
    vi.mocked(boardService.updateObjectInRedis).mockRejectedValue(new Error('Resize failed'));

    const result = await toolExecutor.execute(
      'resizeObject',
      { objectId: 'obj-x', width: 100, height: 100 },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain('Resize failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateText
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — updateText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.updateObjectInRedis).mockResolvedValue(undefined);
  });

  it('happy path: calls updateObjectInRedis with newText mapped to text field', async () => {
    const result = await toolExecutor.execute(
      'updateText',
      { objectId: 'sticky-1', newText: 'Updated content' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(boardService.updateObjectInRedis).toHaveBeenCalledOnce();
    const [, , updates] = vi.mocked(boardService.updateObjectInRedis).mock.calls[0];
    // The executor maps `newText` → `text` in the stored object
    expect(updates).toMatchObject({ text: 'Updated content', lastEditedBy: USER_ID });

    expect(trackedEmit).toHaveBeenCalledOnce();
    expect(vi.mocked(trackedEmit).mock.calls[0][1]).toBe('object:updated');

    expect(result.operation.type).toBe('update');
    expect(result.output.success).toBe(true);
  });

  it('captures boardService error without throwing', async () => {
    vi.mocked(boardService.updateObjectInRedis).mockRejectedValue(new Error('Not found'));

    const result = await toolExecutor.execute(
      'updateText',
      { objectId: 'ghost', newText: 'hello' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain('Not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// changeColor
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — changeColor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.updateObjectInRedis).mockResolvedValue(undefined);
  });

  it('happy path: calls updateObjectInRedis with color and emits object:updated', async () => {
    const result = await toolExecutor.execute(
      'changeColor',
      { objectId: 'obj-3', color: '#FF0000' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(boardService.updateObjectInRedis).toHaveBeenCalledOnce();
    const [, , updates] = vi.mocked(boardService.updateObjectInRedis).mock.calls[0];
    expect(updates).toMatchObject({ color: '#FF0000', lastEditedBy: USER_ID });

    expect(trackedEmit).toHaveBeenCalledOnce();
    expect(vi.mocked(trackedEmit).mock.calls[0][1]).toBe('object:updated');

    expect(result.operation.type).toBe('update');
    expect(result.output.success).toBe(true);
  });

  it('captures boardService error without throwing', async () => {
    vi.mocked(boardService.updateObjectInRedis).mockRejectedValue(new Error('State missing'));

    const result = await toolExecutor.execute(
      'changeColor',
      { objectId: 'ghost', color: '#000000' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteObject
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — deleteObject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.removeObjectFromRedis).mockResolvedValue(undefined);
  });

  it('happy path: calls removeObjectFromRedis and emits object:deleted', async () => {
    const result = await toolExecutor.execute(
      'deleteObject',
      { objectId: 'obj-to-delete' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(boardService.removeObjectFromRedis).toHaveBeenCalledOnce();
    const [calledBoardId, calledObjId] = vi.mocked(boardService.removeObjectFromRedis).mock.calls[0];
    expect(calledBoardId).toBe(BOARD_ID);
    expect(calledObjId).toBe('obj-to-delete');

    expect(trackedEmit).toHaveBeenCalledOnce();
    expect(vi.mocked(trackedEmit).mock.calls[0][1]).toBe('object:deleted');

    expect(result.operation.type).toBe('delete');
    expect(result.operation.objectId).toBe('obj-to-delete');
    expect(result.output.success).toBe(true);
  });

  it('captures boardService error without throwing', async () => {
    vi.mocked(boardService.removeObjectFromRedis).mockRejectedValue(new Error('Object not found'));

    const result = await toolExecutor.execute(
      'deleteObject',
      { objectId: 'ghost-obj' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain('Object not found');
    expect(trackedEmit).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getViewportObjects
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — getViewportObjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns summaries of objects within the viewport', async () => {
    const obj1 = makeBoardObject({ id: 'obj-1', x: 100, y: 100, width: 200, height: 200 });
    const obj2 = makeBoardObject({ id: 'obj-2', x: 200, y: 200, width: 200, height: 200 });
    mockBoardStateWithObjects([obj1, obj2]);

    const result = await toolExecutor.execute(
      'getViewportObjects',
      {},
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(boardService.getOrLoadBoardState).toHaveBeenCalledOnce();
    expect(result.output.success).toBe(true);
    expect(result.output.objectCount).toBe(2);
    expect(Array.isArray(result.output.objects)).toBe(true);
    expect(result.operation.type).toBe('read');
    expect(result.operation.objectId).toBe('viewport');
    // No WS events emitted for reads
    expect(trackedEmit).not.toHaveBeenCalled();
  });

  it('returns zero objects when nothing is in the viewport', async () => {
    const obj = makeBoardObject({ id: 'far-away', x: 0, y: 0, width: 100, height: 100 });
    mockBoardStateWithObjects([obj]);

    const result = await toolExecutor.execute(
      'getViewportObjects',
      {},
      BOARD_ID,
      USER_ID,
      EMPTY_VIEWPORT
    );

    expect(result.output.objectCount).toBe(0);
    expect((result.output.objects as unknown[]).length).toBe(0);
  });

  it('filters by type when filterByType is provided', async () => {
    const sticky = makeBoardObject({ id: 'sticky-1', type: 'sticky', x: 50, y: 50, width: 100, height: 100 });
    const shape = makeBoardObject({ id: 'shape-1', type: 'shape', x: 50, y: 50, width: 100, height: 100 });
    mockBoardStateWithObjects([sticky, shape]);

    const result = await toolExecutor.execute(
      'getViewportObjects',
      { filterByType: 'sticky' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.objectCount).toBe(1);
    const objects = result.output.objects as Array<{ type: string }>;
    expect(objects[0].type).toBe('sticky');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getObjectDetails
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — getObjectDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: returns summary of the requested object', async () => {
    const obj = makeBoardObject({ id: 'obj-detail', x: 10, y: 20, text: 'Some text' });
    mockBoardStateWithObjects([obj]);

    const result = await toolExecutor.execute(
      'getObjectDetails',
      { objectId: 'obj-detail' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(boardService.getOrLoadBoardState).toHaveBeenCalledOnce();
    expect(result.output.success).toBe(true);
    const returnedObj = result.output.object as { id: string };
    expect(returnedObj.id).toBe('obj-detail');
    expect(result.operation.type).toBe('read');
    expect(result.operation.objectId).toBe('obj-detail');
    expect(trackedEmit).not.toHaveBeenCalled();
  });

  it('returns error when object is not found on board', async () => {
    mockBoardStateWithObjects([]);

    const result = await toolExecutor.execute(
      'getObjectDetails',
      { objectId: 'nonexistent' },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toMatch(/not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// batchUpdateByFilter
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — batchUpdateByFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.saveBoardStateToRedis).mockResolvedValue(undefined);
  });

  it('happy path: updates matching objects by type and emits object:updated for each', async () => {
    const s1 = makeBoardObject({ id: 's1', type: 'sticky', x: 100, y: 100, color: '#FFEB3B' });
    const s2 = makeBoardObject({ id: 's2', type: 'sticky', x: 200, y: 200, color: '#FFEB3B' });
    const shape = makeBoardObject({ id: 'sh1', type: 'shape', x: 50, y: 50, color: '#E0E0E0' });
    mockBoardStateWithObjects([s1, s2, shape]);

    const result = await toolExecutor.execute(
      'batchUpdateByFilter',
      { filterByType: 'sticky', updates: { color: '#FF0000' } },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(boardService.saveBoardStateToRedis).toHaveBeenCalledOnce();
    // Two object:updated events for the two stickies
    expect(trackedEmit).toHaveBeenCalledTimes(2);
    vi.mocked(trackedEmit).mock.calls.forEach(call => {
      expect(call[1]).toBe('object:updated');
    });

    expect(result.output.success).toBe(true);
    expect(result.output.affectedCount).toBe(2);
    expect(result.operation.type).toBe('batch_update');
  });

  it('returns affectedCount=0 when no objects match the filter', async () => {
    const shape = makeBoardObject({ id: 'sh1', type: 'shape', x: 50, y: 50 });
    mockBoardStateWithObjects([shape]);

    const result = await toolExecutor.execute(
      'batchUpdateByFilter',
      { filterByType: 'sticky', updates: { color: '#FF0000' } },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.affectedCount).toBe(0);
    expect(trackedEmit).not.toHaveBeenCalled();
    // No save needed if nothing changed
    expect(boardService.saveBoardStateToRedis).not.toHaveBeenCalled();
  });

  it('returns error operation when updates field is missing', async () => {
    // Not testing a throw — executor should return graceful error
    const result = await toolExecutor.execute(
      'batchUpdateByFilter',
      {}, // no updates key
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toMatch(/missing updates/i);
  });

  it('applies relative x/y offsets instead of absolute positions', async () => {
    const obj = makeBoardObject({ id: 'obj-1', type: 'sticky', x: 100, y: 200 });
    const state = mockBoardStateWithObjects([obj]);

    await toolExecutor.execute(
      'batchUpdateByFilter',
      { filterByType: 'sticky', updates: { x: 50, y: -50 } },
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    // The executor mutates cachedState.objects in-place before calling saveBoardStateToRedis
    expect(boardService.saveBoardStateToRedis).toHaveBeenCalledOnce();
    const [, savedState] = vi.mocked(boardService.saveBoardStateToRedis).mock.calls[0];
    const savedObj = (savedState as typeof state).objects.find(o => o.id === 'obj-1');
    expect(savedObj?.x).toBe(150); // 100 + 50
    expect(savedObj?.y).toBe(150); // 200 + (-50)
  });

  it('respects viewportOnly=false to update objects outside viewport', async () => {
    // Object is outside EMPTY_VIEWPORT but viewportOnly=false should still include it
    const obj = makeBoardObject({ id: 'out-of-view', type: 'sticky', x: 0, y: 0 });
    mockBoardStateWithObjects([obj]);

    const result = await toolExecutor.execute(
      'batchUpdateByFilter',
      { filterByType: 'sticky', updates: { color: '#00FF00' }, viewportOnly: false },
      BOARD_ID,
      USER_ID,
      EMPTY_VIEWPORT // Viewport doesn't cover obj position
    );

    expect(result.output.affectedCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown tool
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — unknown tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error operation without throwing for unrecognized tool names', async () => {
    const result = await toolExecutor.execute(
      'notARealTool',
      {},
      BOARD_ID,
      USER_ID,
      FULL_VIEWPORT
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toMatch(/unknown tool/i);
    expect(trackedEmit).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Object ID uniqueness
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — object ID generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.addObjectInRedis).mockResolvedValue(undefined);
  });

  it('generates a unique ID for each created object (uuid v4 format)', async () => {
    mockEmptyBoardState();

    const results = await Promise.all([
      toolExecutor.execute('createStickyNote', { text: 'A', x: 0, y: 0 }, BOARD_ID, USER_ID, FULL_VIEWPORT),
      toolExecutor.execute('createStickyNote', { text: 'B', x: 0, y: 0 }, BOARD_ID, USER_ID, FULL_VIEWPORT),
    ]);

    const id1 = results[0].operation.objectId;
    const id2 = results[1].operation.objectId;

    // UUIDs must be non-empty
    expect(id1.length).toBeGreaterThan(0);
    expect(id2.length).toBeGreaterThan(0);

    // Each call must produce a different ID
    expect(id1).not.toBe(id2);

    // UUID v4 format: 8-4-4-4-12 hex chars
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(id1).toMatch(uuidRegex);
    expect(id2).toMatch(uuidRegex);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI broadcast user ID
// ─────────────────────────────────────────────────────────────────────────────

describe('toolExecutor — WS payload userId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(boardService.addObjectInRedis).mockResolvedValue(undefined);
  });

  it('uses AI_BROADCAST_USER_ID (not the calling userId) in WS payloads', async () => {
    mockEmptyBoardState();

    await toolExecutor.execute(
      'createStickyNote',
      { text: 'AI note', x: 0, y: 0 },
      BOARD_ID,
      'real-user-sub',
      FULL_VIEWPORT
    );

    const [, , payload] = vi.mocked(trackedEmit).mock.calls[0];
    expect((payload as { userId: string }).userId).toBe('system:ai-tacky');
    // The real user is still stored on the object itself
    const [, createdObj] = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
    expect(createdObj.createdBy).toBe('real-user-sub');
  });
});
