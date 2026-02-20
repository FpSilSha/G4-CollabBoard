import { useEffect, useRef } from 'react';
import type { BoardObject, Connector, TextElement } from 'shared';
import { useBoardStore } from '../stores/boardStore';

/** 5-minute cooldown between thumbnail captures (matches backend). */
const COOLDOWN_MS = 5 * 60 * 1000;

/** Maximum base64 string length the backend accepts. */
const MAX_THUMBNAIL_LENGTH = 200_000;

// ---------------------------------------------------------------------------
// Densest-area algorithm
// ---------------------------------------------------------------------------

interface Point {
  cx: number;
  cy: number;
}

/**
 * Find the center of the viewport-sized region containing the most objects.
 *
 * Uses a grid-based O(n) approach:
 * 1. Compute each object's center point in world coordinates.
 * 2. Partition centers into grid cells (cell size ≈ viewport/3).
 * 3. For each cell, sum object counts in its 3×3 neighbourhood.
 * 4. Return the centroid of the densest neighbourhood.
 */
function findDensestRegion(
  objects: Map<string, BoardObject>,
  viewportWidth: number,
  viewportHeight: number,
): Point | null {
  if (objects.size === 0) return null;

  // 1. Gather center points
  const centers: Point[] = [];
  for (const obj of objects.values()) {
    let cx: number;
    let cy: number;

    if (obj.type === 'connector') {
      const c = obj as Connector;
      cx = (c.x + c.x2) / 2;
      cy = (c.y + c.y2) / 2;
    } else if (obj.type === 'text') {
      // TextElement doesn't have width/height — use origin
      const t = obj as TextElement;
      cx = t.x;
      cy = t.y;
    } else {
      // sticky, shape, frame — all have width & height
      const o = obj as { x: number; y: number; width: number; height: number };
      cx = o.x + o.width / 2;
      cy = o.y + o.height / 2;
    }

    centers.push({ cx, cy });
  }

  if (centers.length === 0) return null;
  if (centers.length === 1) return centers[0];

  // 2. Grid setup — cell size ≈ one-third of the viewport
  const cellW = Math.max(viewportWidth / 3, 1);
  const cellH = Math.max(viewportHeight / 3, 1);

  // Find minimum bounds to establish grid origin
  let minCx = Infinity;
  let minCy = Infinity;
  for (const c of centers) {
    if (c.cx < minCx) minCx = c.cx;
    if (c.cy < minCy) minCy = c.cy;
  }

  // Assign objects to grid cells
  const cellCounts = new Map<string, number>();
  const cellSums = new Map<string, { sumX: number; sumY: number }>();

  for (const c of centers) {
    const col = Math.floor((c.cx - minCx) / cellW);
    const row = Math.floor((c.cy - minCy) / cellH);
    const key = `${col},${row}`;
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
    const prev = cellSums.get(key) ?? { sumX: 0, sumY: 0 };
    cellSums.set(key, { sumX: prev.sumX + c.cx, sumY: prev.sumY + c.cy });
  }

  // 3. Score each cell by its 3×3 neighbourhood count
  let bestKey = '';
  let bestCount = 0;

  for (const [key] of cellCounts) {
    const [col, row] = key.split(',').map(Number);
    let count = 0;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        count += cellCounts.get(`${col + dc},${row + dr}`) ?? 0;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }

  if (!bestKey) return centers[0]; // fallback

  // 4. Centroid of the winning neighbourhood
  const [bestCol, bestRow] = bestKey.split(',').map(Number);
  let totalX = 0;
  let totalY = 0;
  let totalN = 0;
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      const nKey = `${bestCol + dc},${bestRow + dr}`;
      const n = cellCounts.get(nKey) ?? 0;
      const sums = cellSums.get(nKey);
      if (n > 0 && sums) {
        totalX += sums.sumX;
        totalY += sums.sumY;
        totalN += n;
      }
    }
  }

  return { cx: totalX / totalN, cy: totalY / totalN };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages thumbnail capture for the current board.
 *
 * Triggers:
 * - **On enter:** captures after `boardStateLoaded` flips to `true`
 *   (set by useCanvasSync after board:state objects are rendered).
 * - **On leave:** the returned `capture` function is called from
 *   BoardView's cleanup effect.
 *
 * Both paths respect a 5-minute cooldown (frontend + backend enforced).
 *
 * @param cachedTokenRef Pre-fetched Auth0 token (avoids stale hook after unmount)
 * @returns `{ capture }` — call this synchronously in cleanup
 */
export function useThumbnailCapture(
  cachedTokenRef: React.MutableRefObject<string | null>,
): { capture: () => void } {
  const lastCaptureRef = useRef<number>(0);

  // Initialise cooldown from server-provided timestamp (once, on first render)
  const thumbnailUpdatedAt = useBoardStore((s) => s.thumbnailUpdatedAt);
  const initRef = useRef(false);
  if (!initRef.current && thumbnailUpdatedAt) {
    lastCaptureRef.current = new Date(thumbnailUpdatedAt).getTime();
    initRef.current = true;
  }

  // -----------------------------------------------------------------------
  // Core capture function (synchronous viewport manipulation + async upload)
  // -----------------------------------------------------------------------
  function capture() {
    // Cooldown check (frontend)
    const now = Date.now();
    const elapsed = now - lastCaptureRef.current;
    if (elapsed < COOLDOWN_MS) {
      console.debug(`[Thumbnail] Cooldown active (${Math.round(elapsed / 1000)}s / ${COOLDOWN_MS / 1000}s)`);
      return;
    }

    const { canvas, boardId, boardVersion, objects } = useBoardStore.getState();

    if (!canvas) { console.debug('[Thumbnail] No canvas'); return; }
    if (!boardId) { console.debug('[Thumbnail] No boardId'); return; }
    if (objects.size === 0) { console.debug('[Thumbnail] No objects in store'); return; }

    const token = cachedTokenRef.current;
    if (!token) {
      console.warn('[Thumbnail] No cached token — skipping capture');
      return;
    }

    const canvasW = canvas.getWidth();
    const canvasH = canvas.getHeight();

    // Find the densest content area
    const region = findDensestRegion(objects, canvasW, canvasH);
    if (!region) { console.debug('[Thumbnail] No dense region found'); return; }

    console.debug(`[Thumbnail] Capturing: boardId=${boardId}, objects=${objects.size}, center=(${Math.round(region.cx)}, ${Math.round(region.cy)})`);

    try {
      // Save current viewport
      const savedVpt = canvas.viewportTransform
        ? [...canvas.viewportTransform]
        : [1, 0, 0, 1, 0, 0];
      const savedZoom = canvas.getZoom();

      // Set viewport to center on densest region at zoom = 1
      const panX = canvasW / 2 - region.cx;
      const panY = canvasH / 2 - region.cy;
      canvas.setViewportTransform([1, 0, 0, 1, panX, panY]);
      canvas.renderAll();

      // Capture at ~300px wide
      const multiplier = 300 / Math.max(canvasW, 1);
      const thumbnail = canvas.toDataURL({
        format: 'jpeg',
        quality: 0.5,
        multiplier,
      });

      // Restore viewport immediately (no visible flicker — paint happens later)
      canvas.setViewportTransform(savedVpt as unknown as number[]);
      canvas.setZoom(savedZoom);
      canvas.renderAll();

      console.debug(`[Thumbnail] Captured: ${thumbnail.length} chars`);

      // Size guard
      if (thumbnail.length > MAX_THUMBNAIL_LENGTH) {
        console.warn('[Thumbnail] Captured data exceeds 200KB, skipping upload');
        return;
      }

      // Update local cooldown
      lastCaptureRef.current = now;

      // Fire-and-forget upload
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      fetch(`${apiUrl}/boards/${boardId}/thumbnail`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ thumbnail, version: boardVersion }),
      }).then((res) => {
        console.debug(`[Thumbnail] Upload response: ${res.status}`);
      }).catch((err) => {
        console.warn('[Thumbnail] Upload failed:', err);
      });
    } catch (err) {
      console.warn('[Thumbnail] Capture failed:', err);
    }
  }

  // -----------------------------------------------------------------------
  // "Enter" trigger — capture after board:state objects are rendered
  // -----------------------------------------------------------------------
  const boardStateLoaded = useBoardStore((s) => s.boardStateLoaded);

  useEffect(() => {
    if (!boardStateLoaded) return;

    console.debug('[Thumbnail] boardStateLoaded=true, scheduling capture...');

    // Wait one animation frame so the canvas has actually painted
    const rafId = requestAnimationFrame(() => {
      console.debug('[Thumbnail] RAF fired, calling capture()');
      capture();
      useBoardStore.getState().setBoardStateLoaded(false);
    });

    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardStateLoaded]);

  return { capture };
}
