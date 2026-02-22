import { useCallback, useState, useEffect, useRef } from 'react';
import { fabric } from 'fabric';
import { useUIStore } from '../../stores/uiStore';
import { useBoardStore } from '../../stores/boardStore';
import {
  COLOR_PALETTES,
  COLOR_PALETTE_TABS,
  type ColorPaletteKey,
} from 'shared';
import { updateStickyColor, updateFrameColor } from '../../utils/fabricHelpers';
import styles from './ColorPicker.module.css';

/**
 * Tabbed color picker displayed in the sidebar.
 *
 * Shows four palette tabs (Pastel / Neon / Earth Tones / WCAG-Accessible),
 * each with 8 preset swatches. Below the palette, a "Saved Colors" section
 * displays up to 10 custom color slots (2 rows × 5). A "+" button toggles
 * the floating ColorPickerPanel (rendered at BoardView level, outside the
 * sidebar DOM) for creating custom colors via HSL sliders.
 */
export function ColorPicker() {
  const activeColor = useUIStore((s) => s.activeColor);
  const setActiveColor = useUIStore((s) => s.setActiveColor);
  const customColors = useUIStore((s) => s.customColors);
  const activeTab = useUIStore((s) => s.colorPaletteTab);
  const setActiveTab = useUIStore((s) => s.setColorPaletteTab);
  const colorPickerOpen = useUIStore((s) => s.colorPickerOpen);
  const setColorPickerOpen = useUIStore((s) => s.setColorPickerOpen);

  // Track which custom slot should play the bounce animation.
  const [bouncingSlot, setBouncingSlot] = useState<number | null>(null);
  const prevCustomColorsRef = useRef<string[]>(customColors);

  // Detect when a new custom color is added and trigger bounce
  useEffect(() => {
    const prev = prevCustomColorsRef.current;
    const curr = customColors;

    if (curr.length > 0 && curr[0] !== prev[0]) {
      setBouncingSlot(0);
    }
    prevCustomColorsRef.current = curr;
  }, [customColors]);

  // Current tab metadata
  const currentTab = COLOR_PALETTE_TABS.find((t) => t.key === activeTab)!;
  const palette = COLOR_PALETTES[activeTab];

  // Build empty slots for custom colors (always show 10 slots)
  const customSlots: (string | null)[] = [];
  for (let i = 0; i < 10; i++) {
    customSlots.push(customColors[i] ?? null);
  }

  /**
   * Handle color selection: set as active color AND apply to any
   * currently selected canvas object.
   */
  const handleColorSelect = useCallback(
    (color: string) => {
      setActiveColor(color);

      const canvas = useBoardStore.getState().canvas;
      if (!canvas) return;

      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;

      const objType = activeObj.data?.type;

      if (objType === 'sticky' && activeObj instanceof fabric.Group) {
        updateStickyColor(activeObj, color);
      } else if (objType === 'text' && activeObj instanceof fabric.IText) {
        const wasEditing = activeObj.isEditing;
        if (wasEditing) activeObj.exitEditing();
        activeObj.set('fill', color);
        if (wasEditing) activeObj.enterEditing();
      } else if (objType === 'frame' && activeObj instanceof fabric.Group) {
        updateFrameColor(activeObj, color);
      } else if (objType === 'connector' || objType === 'line') {
        activeObj.set('stroke', color);
        activeObj.dirty = true; // Force custom _render() to pick up new color
      } else {
        activeObj.set('fill', color);
      }

      canvas.requestRenderAll();
      canvas.fire('object:modified', { target: activeObj });
    },
    [setActiveColor],
  );

  return (
    <div className={styles.colorPicker}>
      {/* Dynamic label — "Colors – {Full Tab Name}" */}
      <div className={styles.label}>
        Colors &ndash; {currentTab.fullLabel}
      </div>

      {/* Tab row */}
      <div className={styles.tabRow}>
        {COLOR_PALETTE_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`${styles.tab} ${
              activeTab === tab.key ? styles.activeTab : ''
            }`}
            onClick={() => setActiveTab(tab.key as ColorPaletteKey)}
            title={tab.fullLabel}
            aria-label={`Switch to ${tab.fullLabel} palette`}
          >
            {tab.shortLabel}
          </button>
        ))}
      </div>

      {/* Preset palette swatches (4×2 grid) */}
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

      {/* Saved colors header with "+" button */}
      <div className={styles.savedHeader}>
        <span className={styles.savedLabel}>Saved Colors</span>
        <button
          className={`${styles.addButton} ${colorPickerOpen ? styles.addButtonActive : ''}`}
          onClick={() => setColorPickerOpen(!colorPickerOpen)}
          title="Add a custom color"
          aria-label="Add a custom color"
        >
          +
        </button>
      </div>

      {/* Custom color slots (5×2 grid) */}
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
            title={color ?? 'Empty — use dropper (I) or + to add'}
            aria-label={
              color
                ? `Select custom color ${color}`
                : `Empty custom color slot ${i + 1}`
            }
          />
        ))}
      </div>
    </div>
  );
}
