import { describe, it, expect } from 'vitest';
import {
  canvasToLocal,
  localToCanvas,
  nearestEdgePoint,
  isPointInsideObject,
  localToAnchor,
  anchorToAbsolute,
  EDGE_SNAP_RADIUS,
} from '../../src/utils/edgeGeometry';
import type { ObjectGeometry } from '../../src/utils/edgeGeometry';

// ─── Geometry fixtures ────────────────────────────────────────────────────────

/** A non-rotated 200x100 rectangle centered at (300, 200) */
function makeRectGeo(overrides: Partial<ObjectGeometry> = {}): ObjectGeometry {
  return {
    centerX: 300,
    centerY: 200,
    halfWidth: 100,
    halfHeight: 50,
    angle: 0,
    isCircle: false,
    ...overrides,
  };
}

/** A circle of radius 50 centered at (200, 150) */
function makeCircleGeo(overrides: Partial<ObjectGeometry> = {}): ObjectGeometry {
  return {
    centerX: 200,
    centerY: 150,
    halfWidth: 50,
    halfHeight: 50,
    angle: 0,
    isCircle: true,
    radius: 50,
    ...overrides,
  };
}

// ─── EDGE_SNAP_RADIUS ─────────────────────────────────────────────────────────

describe('EDGE_SNAP_RADIUS', () => {
  it('is a positive number', () => {
    expect(EDGE_SNAP_RADIUS).toBeGreaterThan(0);
  });

  it('equals 10', () => {
    expect(EDGE_SNAP_RADIUS).toBe(10);
  });
});

// ─── canvasToLocal ────────────────────────────────────────────────────────────

describe('canvasToLocal', () => {
  it('returns {lx:0, ly:0} for a point at the object center (no rotation)', () => {
    const geo = makeRectGeo();
    const result = canvasToLocal({ x: 300, y: 200 }, geo);
    expect(result.lx).toBeCloseTo(0);
    expect(result.ly).toBeCloseTo(0);
  });

  it('transforms a point directly to the right of center', () => {
    const geo = makeRectGeo();
    const result = canvasToLocal({ x: 400, y: 200 }, geo); // 100px right of center
    expect(result.lx).toBeCloseTo(100);
    expect(result.ly).toBeCloseTo(0);
  });

  it('transforms a point directly below center', () => {
    const geo = makeRectGeo();
    const result = canvasToLocal({ x: 300, y: 250 }, geo); // 50px below
    expect(result.lx).toBeCloseTo(0);
    expect(result.ly).toBeCloseTo(50);
  });

  it('correctly rotates a point for a 90-degree rotated object', () => {
    const geo = makeRectGeo({ angle: 90 });
    // A point 100px to the right of center in canvas space,
    // when the object is rotated 90°, should map to (0, -100) in local space
    const result = canvasToLocal({ x: 400, y: 200 }, geo);
    expect(result.lx).toBeCloseTo(0, 1);
    expect(result.ly).toBeCloseTo(-100, 1);
  });

  it('correctly rotates for 45-degree rotation', () => {
    const geo = makeRectGeo({ angle: 45 });
    // 100px to the right in canvas space
    const result = canvasToLocal({ x: 400, y: 200 }, geo);
    // In local space at -45° rotation: lx = cos45*100 ≈ 70.7, ly = -sin45*100 ≈ -70.7
    expect(result.lx).toBeCloseTo(Math.cos(Math.PI / 4) * 100, 1);
    expect(result.ly).toBeCloseTo(-Math.sin(Math.PI / 4) * 100, 1);
  });
});

// ─── localToCanvas ────────────────────────────────────────────────────────────

describe('localToCanvas', () => {
  it('returns the center point for {lx:0, ly:0}', () => {
    const geo = makeRectGeo();
    const result = localToCanvas({ lx: 0, ly: 0 }, geo);
    expect(result.x).toBeCloseTo(300);
    expect(result.y).toBeCloseTo(200);
  });

  it('transforms local right edge to canvas coordinates (no rotation)', () => {
    const geo = makeRectGeo();
    const result = localToCanvas({ lx: 100, ly: 0 }, geo);
    expect(result.x).toBeCloseTo(400);
    expect(result.y).toBeCloseTo(200);
  });

  it('is the inverse of canvasToLocal (round-trip)', () => {
    const geo = makeRectGeo({ angle: 30 });
    const originalPoint = { x: 350, y: 180 };
    const local = canvasToLocal(originalPoint, geo);
    const backToCanvas = localToCanvas(local, geo);

    expect(backToCanvas.x).toBeCloseTo(originalPoint.x, 5);
    expect(backToCanvas.y).toBeCloseTo(originalPoint.y, 5);
  });

  it('round-trips correctly for a 90-degree rotated object', () => {
    const geo = makeRectGeo({ angle: 90 });
    const point = { x: 320, y: 190 };
    const local = canvasToLocal(point, geo);
    const back = localToCanvas(local, geo);

    expect(back.x).toBeCloseTo(point.x, 5);
    expect(back.y).toBeCloseTo(point.y, 5);
  });
});

// ─── nearestEdgePoint — rectangles ───────────────────────────────────────────

describe('nearestEdgePoint (rectangle)', () => {
  it('finds the right edge for a point inside near the right side', () => {
    const geo = makeRectGeo(); // halfWidth=100, halfHeight=50
    // Point at (80, 0) in local space — close to right edge at (100, 0)
    const result = nearestEdgePoint({ lx: 80, ly: 0 }, geo);
    expect(result.edgeLx).toBeCloseTo(100);
    expect(result.edgeLy).toBeCloseTo(0);
    expect(result.distance).toBeCloseTo(20);
  });

  it('finds the left edge for a point inside near the left side', () => {
    const geo = makeRectGeo(); // halfWidth=100
    const result = nearestEdgePoint({ lx: -80, ly: 0 }, geo);
    expect(result.edgeLx).toBeCloseTo(-100);
    expect(result.edgeLy).toBeCloseTo(0);
    expect(result.distance).toBeCloseTo(20);
  });

  it('finds the top edge for a point near the top', () => {
    const geo = makeRectGeo(); // halfHeight=50
    const result = nearestEdgePoint({ lx: 0, ly: -40 }, geo);
    expect(result.edgeLx).toBeCloseTo(0);
    expect(result.edgeLy).toBeCloseTo(-50);
    expect(result.distance).toBeCloseTo(10);
  });

  it('finds the bottom edge for a point near the bottom', () => {
    const geo = makeRectGeo();
    const result = nearestEdgePoint({ lx: 0, ly: 45 }, geo);
    expect(result.edgeLx).toBeCloseTo(0);
    expect(result.edgeLy).toBeCloseTo(50);
    expect(result.distance).toBeCloseTo(5);
  });

  it('returns distance 0 for a point exactly on the edge', () => {
    const geo = makeRectGeo();
    const result = nearestEdgePoint({ lx: 100, ly: 0 }, geo);
    expect(result.distance).toBeCloseTo(0);
    expect(result.edgeLx).toBeCloseTo(100);
  });

  it('handles the center of the rectangle (distance equals min half-dimension)', () => {
    const geo = makeRectGeo(); // halfWidth=100, halfHeight=50
    const result = nearestEdgePoint({ lx: 0, ly: 0 }, geo);
    // Nearest edge from center is top or bottom (halfHeight=50 < halfWidth=100)
    expect(result.distance).toBeCloseTo(50);
  });
});

// ─── nearestEdgePoint — circles ───────────────────────────────────────────────

describe('nearestEdgePoint (circle)', () => {
  it('projects onto circumference for a point inside the circle', () => {
    const geo = makeCircleGeo(); // radius=50
    // Point at (30, 0) — 30 units from center, edge is at 50
    const result = nearestEdgePoint({ lx: 30, ly: 0 }, geo);
    expect(result.edgeLx).toBeCloseTo(50);
    expect(result.edgeLy).toBeCloseTo(0);
    expect(result.distance).toBeCloseTo(20);
  });

  it('projects onto circumference for a point outside the circle', () => {
    const geo = makeCircleGeo(); // radius=50
    // Point at (70, 0) — 70 units from center, edge is at 50
    const result = nearestEdgePoint({ lx: 70, ly: 0 }, geo);
    expect(result.edgeLx).toBeCloseTo(50);
    expect(result.edgeLy).toBeCloseTo(0);
    expect(result.distance).toBeCloseTo(20);
  });

  it('handles a point at center (picks right edge as default)', () => {
    const geo = makeCircleGeo(); // radius=50
    const result = nearestEdgePoint({ lx: 0, ly: 0 }, geo);
    expect(result.edgeLx).toBeCloseTo(50);
    expect(result.edgeLy).toBeCloseTo(0);
    expect(result.distance).toBeCloseTo(50);
  });

  it('handles diagonal points correctly', () => {
    const geo = makeCircleGeo(); // radius=50
    const r = 50 / Math.SQRT2; // ~35.36
    const result = nearestEdgePoint({ lx: r, ly: r }, geo);
    // Should project to the circumference at 45°
    expect(result.edgeLx).toBeCloseTo(50 / Math.SQRT2, 1);
    expect(result.edgeLy).toBeCloseTo(50 / Math.SQRT2, 1);
    expect(result.distance).toBeCloseTo(0, 1);
  });
});

// ─── isPointInsideObject ─────────────────────────────────────────────────────

describe('isPointInsideObject (rectangle)', () => {
  it('returns true for a point inside the rectangle', () => {
    const geo = makeRectGeo();
    expect(isPointInsideObject({ lx: 0, ly: 0 }, geo)).toBe(true);
    expect(isPointInsideObject({ lx: 50, ly: 25 }, geo)).toBe(true);
    expect(isPointInsideObject({ lx: -50, ly: -25 }, geo)).toBe(true);
  });

  it('returns true for a point exactly on the edge', () => {
    const geo = makeRectGeo();
    expect(isPointInsideObject({ lx: 100, ly: 0 }, geo)).toBe(true); // right edge
    expect(isPointInsideObject({ lx: 0, ly: 50 }, geo)).toBe(true);  // bottom edge
  });

  it('returns false for a point outside the rectangle', () => {
    const geo = makeRectGeo();
    expect(isPointInsideObject({ lx: 101, ly: 0 }, geo)).toBe(false);
    expect(isPointInsideObject({ lx: 0, ly: 51 }, geo)).toBe(false);
    expect(isPointInsideObject({ lx: -101, ly: 0 }, geo)).toBe(false);
  });
});

describe('isPointInsideObject (circle)', () => {
  it('returns true for a point inside the circle', () => {
    const geo = makeCircleGeo(); // radius=50
    expect(isPointInsideObject({ lx: 0, ly: 0 }, geo)).toBe(true);
    expect(isPointInsideObject({ lx: 30, ly: 0 }, geo)).toBe(true);
    expect(isPointInsideObject({ lx: 0, ly: -30 }, geo)).toBe(true);
  });

  it('returns true for a point exactly on the circumference', () => {
    const geo = makeCircleGeo(); // radius=50
    expect(isPointInsideObject({ lx: 50, ly: 0 }, geo)).toBe(true);
  });

  it('returns false for a point outside the circle', () => {
    const geo = makeCircleGeo(); // radius=50
    expect(isPointInsideObject({ lx: 51, ly: 0 }, geo)).toBe(false);
    expect(isPointInsideObject({ lx: 0, ly: 51 }, geo)).toBe(false);
  });
});

// ─── localToAnchor ────────────────────────────────────────────────────────────

describe('localToAnchor', () => {
  it('normalizes the right edge to rx=1', () => {
    const geo = makeRectGeo(); // halfWidth=100
    const anchor = localToAnchor({ lx: 100, ly: 0 }, geo);
    expect(anchor.rx).toBeCloseTo(1);
    expect(anchor.ry).toBeCloseTo(0);
  });

  it('normalizes the left edge to rx=-1', () => {
    const geo = makeRectGeo();
    const anchor = localToAnchor({ lx: -100, ly: 0 }, geo);
    expect(anchor.rx).toBeCloseTo(-1);
    expect(anchor.ry).toBeCloseTo(0);
  });

  it('normalizes the bottom edge to ry=1', () => {
    const geo = makeRectGeo(); // halfHeight=50
    const anchor = localToAnchor({ lx: 0, ly: 50 }, geo);
    expect(anchor.rx).toBeCloseTo(0);
    expect(anchor.ry).toBeCloseTo(1);
  });

  it('normalizes center to rx=0, ry=0', () => {
    const geo = makeRectGeo();
    const anchor = localToAnchor({ lx: 0, ly: 0 }, geo);
    expect(anchor.rx).toBeCloseTo(0);
    expect(anchor.ry).toBeCloseTo(0);
  });

  it('handles zero halfWidth gracefully (returns rx=0)', () => {
    const geo = makeRectGeo({ halfWidth: 0 });
    const anchor = localToAnchor({ lx: 5, ly: 0 }, geo);
    expect(anchor.rx).toBe(0);
  });

  it('handles zero halfHeight gracefully (returns ry=0)', () => {
    const geo = makeRectGeo({ halfHeight: 0 });
    const anchor = localToAnchor({ lx: 0, ly: 5 }, geo);
    expect(anchor.ry).toBe(0);
  });
});

// ─── anchorToAbsolute ─────────────────────────────────────────────────────────

describe('anchorToAbsolute', () => {
  it('converts the right edge anchor to canvas coordinates (no rotation)', () => {
    const geo = makeRectGeo(); // center (300,200), halfWidth=100
    const result = anchorToAbsolute({ rx: 1, ry: 0 }, geo);
    expect(result.x).toBeCloseTo(400);
    expect(result.y).toBeCloseTo(200);
  });

  it('converts the left edge anchor to canvas coordinates (no rotation)', () => {
    const geo = makeRectGeo();
    const result = anchorToAbsolute({ rx: -1, ry: 0 }, geo);
    expect(result.x).toBeCloseTo(200);
    expect(result.y).toBeCloseTo(200);
  });

  it('converts the bottom edge anchor to canvas coordinates (no rotation)', () => {
    const geo = makeRectGeo(); // halfHeight=50
    const result = anchorToAbsolute({ rx: 0, ry: 1 }, geo);
    expect(result.x).toBeCloseTo(300);
    expect(result.y).toBeCloseTo(250);
  });

  it('converts center anchor to object center', () => {
    const geo = makeRectGeo();
    const result = anchorToAbsolute({ rx: 0, ry: 0 }, geo);
    expect(result.x).toBeCloseTo(300);
    expect(result.y).toBeCloseTo(200);
  });

  it('is the inverse of localToAnchor + canvasToLocal (round-trip)', () => {
    const geo = makeRectGeo({ angle: 45 });
    const originalCanvas = { x: 350, y: 220 };
    const local = canvasToLocal(originalCanvas, geo);
    const anchor = localToAnchor(local, geo);
    const backToCanvas = anchorToAbsolute(anchor, geo);

    expect(backToCanvas.x).toBeCloseTo(originalCanvas.x, 5);
    expect(backToCanvas.y).toBeCloseTo(originalCanvas.y, 5);
  });

  it('applies rotation correctly for a 90-degree rotated object', () => {
    const geo = makeRectGeo({ angle: 90, centerX: 0, centerY: 0 });
    // Right edge anchor (rx=1, ry=0) with halfWidth=100
    // In local space: (100, 0); rotated 90° → (0, 100) in canvas space
    const result = anchorToAbsolute({ rx: 1, ry: 0 }, geo);
    expect(result.x).toBeCloseTo(0, 1);
    expect(result.y).toBeCloseTo(100, 1);
  });
});
