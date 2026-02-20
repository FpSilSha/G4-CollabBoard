import { useCallback, useState, useEffect, useRef } from 'react';
import { fabric } from 'fabric';
import { useUIStore } from '../../stores/uiStore';
import { useBoardStore } from '../../stores/boardStore';
import { SHAPE_COLORS } from 'shared';
import { updateStickyColor, updateFrameColor } from '../../utils/fabricHelpers';
import styles from './ColorPicker.module.css';

/**
 * Color picker displayed in the sidebar.
 *
 * Shows the SHAPE_COLORS palette (8 colors) for all tools.
 * STICKY_NOTE_COLORS and high-energy PRESENCE_COLORS are NOT shown here —
 * those palettes are reserved for user profiles, presence, and cursors.
 *
 * Below the preset palette, shows up to 10 custom color slots (2 rows of 5).
 * Custom colors are populated by the dropper tool.
 *
 * When an object is selected on the canvas, clicking a swatch will also
 * update that object's fill color in real-time.
 */
export function ColorPicker() {
  const activeColor = useUIStore((s) => s.activeColor);
  const setActiveColor = useUIStore((s) => s.setActiveColor);
  const customColors = useUIStore((s) => s.customColors);

  // Track which custom slot should play the bounce animation.
  // Set to the slot index when the dropper adds a new color, cleared after animation ends.
  const [bouncingSlot, setBouncingSlot] = useState<number | null>(null);
  const prevCustomColorsRef = useRef<string[]>(customColors);

  // Detect when a new custom color is added (dropper pick) and trigger bounce
  useEffect(() => {
    const prev = prevCustomColorsRef.current;
    const curr = customColors;

    if (curr.length > 0 && curr[0] !== prev[0]) {
      // The newest color is always at index 0
      setBouncingSlot(0);
    }
    prevCustomColorsRef.current = curr;
  }, [customColors]);

  // Single palette for all tools — SHAPE_COLORS only
  const palette: readonly string[] = SHAPE_COLORS;

  // Build empty slots for custom colors (always show 10 slots)
  const customSlots: (string | null)[] = [];
  for (let i = 0; i < 10; i++) {
    customSlots.push(customColors[i] ?? null);
  }

  /**
   * Handle color selection: set as active color AND apply to any
   * currently selected canvas object.
   */
  const handleColorSelect = useCallback((color: string) => {
    setActiveColor(color);

    // If an object is selected, update its fill color
    const canvas = useBoardStore.getState().canvas;
    if (!canvas) return;

    const activeObj = canvas.getActiveObject();
    if (!activeObj) return;

    const objType = activeObj.data?.type;

    if (objType === 'sticky' && activeObj instanceof fabric.Group) {
      // Sticky notes are Groups — update base + fold via helper
      updateStickyColor(activeObj, color);
    } else if (objType === 'text' && activeObj instanceof fabric.IText) {
      // Text elements: if currently in editing mode, exit first so
      // Fabric.js re-renders with the new fill color immediately.
      const wasEditing = activeObj.isEditing;
      if (wasEditing) {
        activeObj.exitEditing();
      }
      activeObj.set('fill', color);
      if (wasEditing) {
        activeObj.enterEditing();
      }
    } else if (objType === 'frame' && activeObj instanceof fabric.Group) {
      // Frames: update the border rect's stroke and label color
      updateFrameColor(activeObj, color);
    } else if (objType === 'connector') {
      // Connectors: update stroke color (not fill)
      activeObj.set('stroke', color);
    } else {
      // Shapes (rect, circle) — update fill directly
      activeObj.set('fill', color);
    }

    canvas.requestRenderAll();

    // Fire object:modified so useCanvasSync picks up the color change
    // and emits it over the WebSocket. Programmatic property changes
    // don't trigger this event automatically in Fabric.js.
    canvas.fire('object:modified', { target: activeObj });
  }, [setActiveColor]);

  return (
    <div className={styles.colorPicker}>
      {/* Preset palette */}
      <div className={styles.label}>Color</div>
      <div className={styles.swatchGrid}>
        {palette.map((color) => (
          <button
            key={color}
            className={`${styles.swatch} ${
              color === activeColor ? styles.activeSwatch : ''
            }`}
            style={{ backgroundColor: color }}
            onClick={() => handleColorSelect(color)}
            title={color}
            aria-label={`Select color ${color}`}
          />
        ))}
      </div>

      {/* Custom colors (dropper-sampled) */}
      <div className={styles.customLabel}>Custom</div>
      <div className={styles.swatchGrid}>
        {customSlots.map((color, i) => (
          <button
            key={`custom-${i}`}
            className={`${styles.swatch} ${styles.customSwatch} ${
              color && color === activeColor ? styles.activeSwatch : ''
            } ${!color ? styles.emptySwatch : ''} ${
              bouncingSlot === i ? styles.dropperBounce : ''
            }`}
            style={color ? { backgroundColor: color } : undefined}
            onClick={() => color && handleColorSelect(color)}
            onAnimationEnd={() => {
              if (bouncingSlot === i) setBouncingSlot(null);
            }}
            disabled={!color}
            title={color ?? 'Empty — use dropper (I) to sample'}
            aria-label={color ? `Select custom color ${color}` : `Empty custom color slot ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
