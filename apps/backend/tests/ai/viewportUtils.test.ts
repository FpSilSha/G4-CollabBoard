import { describe, it, expect } from 'vitest';
import {
  isObjectInViewport,
  distanceToViewportCenter,
  getViewportFilteredObjects,
  summarizeObject,
  getObjectById,
} from '../../src/ai/viewportUtils';
import type { BoardObject, ViewportBounds } from 'shared';

// ─── Test data helpers ────────────────────────────────────────────────────────

function makeViewport(overrides: Partial<ViewportBounds> = {}): ViewportBounds {
  return { x: 0, y: 0, width: 1000, height: 800, zoom: 1, ...overrides };
}

function makeSticky(overrides: Partial<Record<string, unknown>> = {}): BoardObject {
  return {
    id: 'sticky-1',
    type: 'sticky',
    x: 100,
    y: 100,
    width: 200,
    height: 200,
    text: 'Hello',
    color: '#FFEB3B',
    frameId: null,
    createdBy: 'user-1',
    lastEditedBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BoardObject;
}

function makeShape(overrides: Partial<Record<string, unknown>> = {}): BoardObject {
  return {
    id: 'shape-1',
    type: 'shape',
    x: 200,
    y: 200,
    width: 100,
    height: 100,
    shapeType: 'rectangle',
    color: '#FF0000',
    rotation: 0,
    frameId: null,
    createdBy: 'user-1',
    lastEditedBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BoardObject;
}

function makeFrame(overrides: Partial<Record<string, unknown>> = {}): BoardObject {
  return {
    id: 'frame-1',
    type: 'frame',
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    title: 'My Frame',
    color: '#E0E0E0',
    locked: false,
    frameId: null,
    createdBy: 'user-1',
    lastEditedBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BoardObject;
}

function makeConnector(overrides: Partial<Record<string, unknown>> = {}): BoardObject {
  return {
    id: 'conn-1',
    type: 'connector',
    x: 100,
    y: 100,
    x2: 400,
    y2: 400,
    fromObjectId: 'obj-a',
    toObjectId: 'obj-b',
    style: 'arrow',
    color: '#757575',
    frameId: null,
    createdBy: 'user-1',
    lastEditedBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BoardObject;
}

function makeLine(overrides: Partial<Record<string, unknown>> = {}): BoardObject {
  return {
    id: 'line-1',
    type: 'line',
    x: 50,
    y: 50,
    x2: 300,
    y2: 300,
    color: '#000000',
    endpointStyle: 'none',
    strokePattern: 'solid',
    strokeWeight: 'normal',
    frameId: null,
    createdBy: 'user-1',
    lastEditedBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BoardObject;
}

function makeText(overrides: Partial<Record<string, unknown>> = {}): BoardObject {
  return {
    id: 'text-1',
    type: 'text',
    x: 300,
    y: 300,
    text: 'Some text',
    fontSize: 16,
    color: '#212121',
    frameId: null,
    createdBy: 'user-1',
    lastEditedBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BoardObject;
}

// ─── isObjectInViewport ───────────────────────────────────────────────────────

describe('isObjectInViewport', () => {
  describe('rectangular objects (sticky, shape, frame, text)', () => {
    it('returns true when object is fully inside viewport', () => {
      const sticky = makeSticky({ x: 100, y: 100, width: 200, height: 200 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(sticky, viewport)).toBe(true);
    });

    it('returns false when object is fully to the right of viewport', () => {
      const sticky = makeSticky({ x: 1100, y: 100, width: 200, height: 200 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(sticky, viewport)).toBe(false);
    });

    it('returns false when object is fully to the left of viewport', () => {
      const sticky = makeSticky({ x: -300, y: 100, width: 200, height: 200 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(sticky, viewport)).toBe(false);
    });

    it('returns false when object is fully below viewport', () => {
      const sticky = makeSticky({ x: 100, y: 900, width: 200, height: 200 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(sticky, viewport)).toBe(false);
    });

    it('returns false when object is fully above viewport', () => {
      const sticky = makeSticky({ x: 100, y: -300, width: 200, height: 200 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(sticky, viewport)).toBe(false);
    });

    it('returns true when object partially overlaps viewport on the right', () => {
      // Object starts at x=900, width=200 → right edge at 1100 > viewport.x (0)
      // Object left (900) < viewport right (1000) → overlap
      const sticky = makeSticky({ x: 900, y: 100, width: 200, height: 200 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(sticky, viewport)).toBe(true);
    });

    it('returns true when object partially overlaps viewport on the bottom', () => {
      const sticky = makeSticky({ x: 100, y: 700, width: 200, height: 200 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(sticky, viewport)).toBe(true);
    });

    it('returns true when object completely contains the viewport (large object)', () => {
      // A huge object that surrounds the viewport
      const frame = makeFrame({ x: -100, y: -100, width: 2000, height: 2000 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(frame, viewport)).toBe(true);
    });

    it('returns false for an object at the right edge (touching, not overlapping)', () => {
      // Object right edge exactly at viewport.x — AABB: obj.x < vRight is 1000 < 1000 = false
      const sticky = makeSticky({ x: 1000, y: 0, width: 100, height: 100 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      // obj.x (1000) < vRight (1000) → false → not in viewport
      expect(isObjectInViewport(sticky, viewport)).toBe(false);
    });

    it('works with non-zero viewport origin (scrolled board)', () => {
      const sticky = makeSticky({ x: 500, y: 500, width: 100, height: 100 });
      const viewport = makeViewport({ x: 400, y: 400, width: 1000, height: 800 });
      expect(isObjectInViewport(sticky, viewport)).toBe(true);
    });

    it('returns false when viewport is scrolled past object', () => {
      const sticky = makeSticky({ x: 0, y: 0, width: 100, height: 100 });
      const viewport = makeViewport({ x: 200, y: 200, width: 1000, height: 800 });
      expect(isObjectInViewport(sticky, viewport)).toBe(false);
    });
  });

  describe('connector objects', () => {
    it('returns true when start point is inside viewport', () => {
      const conn = makeConnector({ x: 100, y: 100, x2: 2000, y2: 2000 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(conn, viewport)).toBe(true);
    });

    it('returns true when end point is inside viewport', () => {
      const conn = makeConnector({ x: 2000, y: 2000, x2: 500, y2: 400 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(conn, viewport)).toBe(true);
    });

    it('returns false when neither endpoint is inside viewport', () => {
      const conn = makeConnector({ x: 1100, y: 100, x2: 1500, y2: 200 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(conn, viewport)).toBe(false);
    });

    it('returns true when both endpoints are inside viewport', () => {
      const conn = makeConnector({ x: 100, y: 100, x2: 500, y2: 400 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(conn, viewport)).toBe(true);
    });
  });

  describe('line objects', () => {
    it('returns true when start point is inside viewport', () => {
      const line = makeLine({ x: 50, y: 50, x2: 2000, y2: 2000 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(line, viewport)).toBe(true);
    });

    it('returns false when neither endpoint is inside viewport', () => {
      const line = makeLine({ x: 1100, y: 50, x2: 1500, y2: 100 });
      const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
      expect(isObjectInViewport(line, viewport)).toBe(false);
    });
  });
});

// ─── distanceToViewportCenter ─────────────────────────────────────────────────

describe('distanceToViewportCenter', () => {
  it('returns 0 for an object centered exactly at the viewport center', () => {
    // Viewport center = (500, 400). Object center = (500, 400) → x=400, width=200 → center=500
    const sticky = makeSticky({ x: 400, y: 300, width: 200, height: 200 });
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
    expect(distanceToViewportCenter(sticky, viewport)).toBe(0);
  });

  it('returns correct distance for object offset from center', () => {
    // Viewport center = (500, 400). Object center = (600, 400)
    // dx = 100, dy = 0 → distance = 100
    const sticky = makeSticky({ x: 500, y: 300, width: 200, height: 200 });
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
    expect(distanceToViewportCenter(sticky, viewport)).toBeCloseTo(100, 5);
  });

  it('returns positive distance for object not at center', () => {
    const sticky = makeSticky({ x: 0, y: 0, width: 100, height: 100 });
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
    const distance = distanceToViewportCenter(sticky, viewport);
    expect(distance).toBeGreaterThan(0);
  });

  it('uses midpoint for connector distance calculation', () => {
    // Connector from (0,0) to (1000, 800): midpoint = (500, 400) = viewport center
    const conn = makeConnector({ x: 0, y: 0, x2: 1000, y2: 800 });
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
    expect(distanceToViewportCenter(conn, viewport)).toBe(0);
  });

  it('uses midpoint for line distance calculation', () => {
    // Line from (0,0) to (1000, 800): midpoint = (500, 400) = viewport center
    const line = makeLine({ x: 0, y: 0, x2: 1000, y2: 800 });
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
    expect(distanceToViewportCenter(line, viewport)).toBe(0);
  });

  it('closer object has smaller distance than farther object', () => {
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });
    const near = makeSticky({ id: 'near', x: 450, y: 350, width: 100, height: 100 });
    const far = makeSticky({ id: 'far', x: 0, y: 0, width: 100, height: 100 });
    expect(distanceToViewportCenter(near, viewport)).toBeLessThan(
      distanceToViewportCenter(far, viewport)
    );
  });
});

// ─── getViewportFilteredObjects ───────────────────────────────────────────────

describe('getViewportFilteredObjects', () => {
  it('returns only objects within viewport', () => {
    const inView = makeSticky({ id: 'in', x: 100, y: 100, width: 100, height: 100 });
    const outOfView = makeSticky({ id: 'out', x: 5000, y: 5000, width: 100, height: 100 });
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });

    const result = getViewportFilteredObjects([inView, outOfView], viewport);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('in');
  });

  it('returns empty array when no objects are in viewport', () => {
    const objects = [
      makeSticky({ id: 'a', x: 2000, y: 2000, width: 100, height: 100 }),
      makeSticky({ id: 'b', x: 3000, y: 3000, width: 100, height: 100 }),
    ];
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });

    expect(getViewportFilteredObjects(objects, viewport)).toHaveLength(0);
  });

  it('returns all objects when all are in viewport', () => {
    const objects = [
      makeSticky({ id: 'a', x: 100, y: 100, width: 100, height: 100 }),
      makeSticky({ id: 'b', x: 300, y: 300, width: 100, height: 100 }),
    ];
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });

    expect(getViewportFilteredObjects(objects, viewport)).toHaveLength(2);
  });

  it('filters by type when filterByType option is provided', () => {
    const sticky = makeSticky({ id: 'sticky', x: 100, y: 100, width: 100, height: 100 });
    const shape = makeShape({ id: 'shape', x: 200, y: 200, width: 100, height: 100 });
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });

    const result = getViewportFilteredObjects([sticky, shape], viewport, { filterByType: 'sticky' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sticky');
  });

  it('filters by color when filterByColor option is provided', () => {
    const yellow = makeSticky({ id: 'yellow', x: 100, y: 100, color: '#FFEB3B' });
    const pink = makeSticky({ id: 'pink', x: 200, y: 200, color: '#F48FB1' });
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });

    const result = getViewportFilteredObjects([yellow, pink], viewport, {
      filterByColor: '#FFEB3B',
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('yellow');
  });

  it('color filter is case-insensitive', () => {
    const sticky = makeSticky({ id: 'sticky', x: 100, y: 100, color: '#ffeb3b' });
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });

    const result = getViewportFilteredObjects([sticky], viewport, { filterByColor: '#FFEB3B' });
    expect(result).toHaveLength(1);
  });

  it('sorts results by distance to viewport center (nearest first)', () => {
    // Viewport center = (500, 400)
    const near = makeSticky({ id: 'near', x: 450, y: 350, width: 100, height: 100 }); // center=500,400
    const far = makeSticky({ id: 'far', x: 0, y: 0, width: 100, height: 100 });       // center=50,50
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });

    // Shuffled input order
    const result = getViewportFilteredObjects([far, near], viewport);
    expect(result[0].id).toBe('near');
    expect(result[1].id).toBe('far');
  });

  it('caps results at the provided cap value', () => {
    const objects = Array.from({ length: 10 }, (_, i) =>
      makeSticky({ id: `obj-${i}`, x: i * 50, y: 0, width: 40, height: 40 })
    );
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });

    const result = getViewportFilteredObjects(objects, viewport, { cap: 3 });
    expect(result).toHaveLength(3);
  });

  it('uses AI_CONFIG.VIEWPORT_OBJECT_CAP as default cap', () => {
    // Create 60 objects all in viewport
    const objects = Array.from({ length: 60 }, (_, i) =>
      makeSticky({ id: `obj-${i}`, x: (i % 10) * 80, y: Math.floor(i / 10) * 80, width: 60, height: 60 })
    );
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });

    const result = getViewportFilteredObjects(objects, viewport);
    // AI_CONFIG.VIEWPORT_OBJECT_CAP = 50
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('returns empty array when objects array is empty', () => {
    const viewport = makeViewport();
    expect(getViewportFilteredObjects([], viewport)).toHaveLength(0);
  });

  it('can filter by both type and color simultaneously', () => {
    const yellowSticky = makeSticky({ id: 'ys', x: 100, y: 100, color: '#FFEB3B' });
    const pinkSticky = makeSticky({ id: 'ps', x: 200, y: 200, color: '#F48FB1' });
    const yellowShape = makeShape({ id: 'ySh', x: 300, y: 300, color: '#FFEB3B' });
    const viewport = makeViewport({ x: 0, y: 0, width: 1000, height: 800 });

    const result = getViewportFilteredObjects(
      [yellowSticky, pinkSticky, yellowShape],
      viewport,
      { filterByType: 'sticky', filterByColor: '#FFEB3B' }
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ys');
  });
});

// ─── summarizeObject ──────────────────────────────────────────────────────────

describe('summarizeObject', () => {
  it('summarizes a sticky note with text, color, width, height, frameId', () => {
    const sticky = makeSticky({
      id: 'sticky-1', x: 100, y: 200, text: 'Hello', color: '#FFEB3B',
      width: 200, height: 200, frameId: 'frame-a',
    });
    const result = summarizeObject(sticky);
    expect(result).toMatchObject({
      id: 'sticky-1',
      type: 'sticky',
      x: 100,
      y: 200,
      text: 'Hello',
      color: '#FFEB3B',
      width: 200,
      height: 200,
      frameId: 'frame-a',
    });
  });

  it('summarizes a shape with shapeType, width, height, color, rotation', () => {
    const shape = makeShape({ id: 'shape-1', x: 10, y: 20, shapeType: 'circle', width: 100, height: 100, color: '#FF0000', rotation: 45 });
    const result = summarizeObject(shape);
    expect(result).toMatchObject({
      id: 'shape-1',
      type: 'shape',
      shapeType: 'circle',
      width: 100,
      height: 100,
      color: '#FF0000',
      rotation: 45,
    });
  });

  it('summarizes a frame with title, width, height, color', () => {
    const frame = makeFrame({ id: 'frame-1', x: 0, y: 0, title: 'Sprint 1', width: 800, height: 600, color: '#E0E0E0' });
    const result = summarizeObject(frame);
    expect(result).toMatchObject({
      id: 'frame-1',
      type: 'frame',
      title: 'Sprint 1',
      width: 800,
      height: 600,
      color: '#E0E0E0',
    });
  });

  it('summarizes a connector with fromObjectId, toObjectId, style, color, x2, y2', () => {
    const conn = makeConnector({
      id: 'conn-1', x: 0, y: 0, x2: 500, y2: 300,
      fromObjectId: 'obj-a', toObjectId: 'obj-b',
      style: 'arrow', color: '#757575',
    });
    const result = summarizeObject(conn);
    expect(result).toMatchObject({
      id: 'conn-1',
      type: 'connector',
      fromObjectId: 'obj-a',
      toObjectId: 'obj-b',
      style: 'arrow',
      color: '#757575',
      x2: 500,
      y2: 300,
    });
  });

  it('summarizes a text element with text, fontSize, color', () => {
    const text = makeText({ id: 'text-1', x: 100, y: 200, text: 'Label', fontSize: 24, color: '#212121' });
    const result = summarizeObject(text);
    expect(result).toMatchObject({
      id: 'text-1',
      type: 'text',
      text: 'Label',
      fontSize: 24,
      color: '#212121',
    });
  });

  it('summarizes a line with x2, y2, color, endpointStyle, strokePattern, strokeWeight', () => {
    const line = makeLine({
      id: 'line-1', x: 10, y: 20, x2: 400, y2: 500,
      color: '#000', endpointStyle: 'arrow-end', strokePattern: 'dashed', strokeWeight: 'bold',
    });
    const result = summarizeObject(line);
    expect(result).toMatchObject({
      id: 'line-1',
      type: 'line',
      x2: 400,
      y2: 500,
      color: '#000',
      endpointStyle: 'arrow-end',
      strokePattern: 'dashed',
      strokeWeight: 'bold',
    });
  });

  it('always includes base fields: id, type, x, y', () => {
    const sticky = makeSticky({ id: 'any-id', x: 42, y: 99 });
    const result = summarizeObject(sticky);
    expect(result.id).toBe('any-id');
    expect(result.type).toBe('sticky');
    expect(result.x).toBe(42);
    expect(result.y).toBe(99);
  });

  it('does not include raw dates (createdAt, updatedAt)', () => {
    const sticky = makeSticky();
    const result = summarizeObject(sticky);
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('updatedAt');
    expect(result).not.toHaveProperty('createdBy');
  });
});

// ─── getObjectById ────────────────────────────────────────────────────────────

describe('getObjectById', () => {
  it('returns the object when found by ID', () => {
    const target = makeSticky({ id: 'target-id' });
    const objects = [makeSticky({ id: 'other-1' }), target, makeSticky({ id: 'other-2' })];

    const result = getObjectById(objects as BoardObject[], 'target-id');
    expect(result).toBe(target);
  });

  it('returns null when object is not found', () => {
    const objects = [makeSticky({ id: 'a' }), makeSticky({ id: 'b' })];
    expect(getObjectById(objects as BoardObject[], 'nonexistent')).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(getObjectById([], 'any-id')).toBeNull();
  });

  it('returns the first match (in case of duplicate IDs)', () => {
    const first = makeSticky({ id: 'dup', x: 1, y: 1 });
    const second = makeSticky({ id: 'dup', x: 2, y: 2 });
    const result = getObjectById([first, second] as BoardObject[], 'dup');
    expect(result).toBe(first);
  });

  it('works with mixed object types', () => {
    const connector = makeConnector({ id: 'conn-target' });
    const objects: BoardObject[] = [
      makeSticky({ id: 'sticky-1' }) as BoardObject,
      connector as BoardObject,
      makeFrame({ id: 'frame-1' }) as BoardObject,
    ];
    expect(getObjectById(objects, 'conn-target')).toBe(connector);
  });
});
