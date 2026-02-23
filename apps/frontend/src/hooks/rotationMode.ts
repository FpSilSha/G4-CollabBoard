import { fabric } from 'fabric';

// ============================================================
// Rotation Mode (R key toggle)
// ============================================================

/**
 * Tracks which object is currently in rotation mode.
 * When active, the object hides resize handles and only shows the rotation control.
 * Press R again, Escape, or deselect to exit.
 */
let rotationModeObjectId: string | null = null;

/** Saved control visibility so we can restore on exit. */
let savedControlVisibility: Record<string, boolean> | null = null;

/** Whether rotation mode is currently active. */
export function isRotationModeActive(): boolean {
  return rotationModeObjectId !== null;
}

/**
 * Toggle rotation mode on the given object.
 * In rotation mode: all resize controls are hidden, only the rotation
 * control (mtr) is visible. The object's lockMovement is set to prevent
 * accidental moves while rotating.
 */
export function toggleRotationMode(canvas: fabric.Canvas, obj: fabric.Object): void {
  if (rotationModeObjectId === obj.data?.id) {
    // Already in rotation mode on this object — exit
    exitRotationMode(canvas);
    return;
  }

  // If rotation mode was on a different object, exit it first
  if (rotationModeObjectId) {
    exitRotationMode(canvas);
  }

  // Don't allow rotation on stickies (they have hasControls: false)
  if (obj.data?.type === 'sticky') return;

  rotationModeObjectId = obj.data?.id ?? null;

  // Save current control visibility and hide all except rotation (mtr)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const objAny = obj as any;
  savedControlVisibility = {};
  const controlKeys = ['tl', 'tr', 'bl', 'br', 'ml', 'mr', 'mt', 'mb'];
  for (const key of controlKeys) {
    savedControlVisibility[key] = objAny._controlsVisibility?.[key] ?? true;
    obj.setControlVisible(key, false);
  }

  // Make sure the rotation control IS visible
  obj.setControlVisible('mtr', true);
  obj.lockMovementX = true;
  obj.lockMovementY = true;

  canvas.requestRenderAll();
}

/**
 * Exit rotation mode: restore all control visibility and unlock movement.
 */
export function exitRotationMode(canvas: fabric.Canvas): void {
  if (!rotationModeObjectId) return;

  const obj = canvas.getObjects().find((o) => o.data?.id === rotationModeObjectId);
  if (obj && savedControlVisibility) {
    // Restore saved control visibility
    for (const [key, visible] of Object.entries(savedControlVisibility)) {
      obj.setControlVisible(key, visible);
    }

    // Restore movement (unless it was locked for another reason like sticky)
    const isSticky = obj.data?.type === 'sticky';
    if (!isSticky) {
      obj.lockMovementX = false;
      obj.lockMovementY = false;
    }
  }

  rotationModeObjectId = null;
  savedControlVisibility = null;
  canvas.requestRenderAll();
}

/**
 * Hook into selection changes to exit rotation mode when the user
 * selects a different object or deselects all.
 * Called from useCanvas setup.
 */
export function setupRotationModeListeners(canvas: fabric.Canvas): () => void {
  const onSelectionCleared = () => {
    if (rotationModeObjectId) {
      exitRotationMode(canvas);
    }
  };

  const onSelectionUpdated = () => {
    if (rotationModeObjectId) {
      exitRotationMode(canvas);
    }
  };

  canvas.on('selection:cleared', onSelectionCleared);
  canvas.on('selection:updated', onSelectionUpdated);

  return () => {
    canvas.off('selection:cleared', onSelectionCleared);
    canvas.off('selection:updated', onSelectionUpdated);
  };
}
