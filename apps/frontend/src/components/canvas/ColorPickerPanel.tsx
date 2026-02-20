import { useState, useEffect, useRef, useCallback } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { HSL_CONSTRAINTS, type HslConstraintKey } from 'shared';
import styles from './ColorPickerPanel.module.css';

// ── Helpers ───────────────────────────────────────────────────────────

/** Convert HSL (h 0-360, s 0-100, l 0-100) → hex string */
function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

/** Convert hex → HSL (h 0-360, s 0-100, l 0-100) */
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, Math.round(l * 100)];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

/** Clamp value within a min/max range */
function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

/** Midpoint of a range */
function mid(min: number, max: number): number {
  return Math.round((min + max) / 2);
}

// ── Constraint tab metadata ───────────────────────────────────────────

const CONSTRAINT_TABS: { key: HslConstraintKey; label: string }[] = [
  { key: 'pastel', label: 'PST' },
  { key: 'neon', label: 'NEO' },
  { key: 'earth', label: 'ERT' },
  { key: 'none', label: 'None' },
];

// ── Component ─────────────────────────────────────────────────────────

/**
 * Floating custom color picker panel.
 *
 * Rendered at BoardView level with fixed positioning, anchored to the
 * right edge of the left sidebar. Contains HSL sliders with constraint
 * tabs (PST/NEO/ERT/None), live preview, hex input, "Add Color" button,
 * and "Done" button. Users can add multiple custom colors before closing.
 *
 * Closes when:
 * - User clicks "Done"
 * - User clicks the canvas (mousedown outside panel)
 * - User changes tool (handled by uiStore.setActiveTool)
 * - Sidebar closes (handled by uiStore.setSidebarOpen)
 * - User presses Escape
 */
export function ColorPickerPanel() {
  const isOpen = useUIStore((s) => s.colorPickerOpen);
  const setOpen = useUIStore((s) => s.setColorPickerOpen);
  const addCustomColor = useUIStore((s) => s.addCustomColor);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  const panelRef = useRef<HTMLDivElement>(null);

  // Internal constraint tab
  const [constraintTab, setConstraintTab] = useState<HslConstraintKey>('pastel');
  const constraints = HSL_CONSTRAINTS[constraintTab];

  // HSL state
  const [hue, setHue] = useState(() => mid(constraints.hMin, constraints.hMax));
  const [sat, setSat] = useState(() => mid(constraints.sMin, constraints.sMax));
  const [lit, setLit] = useState(() => mid(constraints.lMin, constraints.lMax));

  // Hex input state (for bidirectional sync)
  const [hexInput, setHexInput] = useState(() => hslToHex(hue, sat, lit));

  // Sync hex input when sliders change
  useEffect(() => {
    setHexInput(hslToHex(hue, sat, lit));
  }, [hue, sat, lit]);

  // When constraint tab changes, re-clamp sliders
  const handleConstraintTabChange = useCallback(
    (key: HslConstraintKey) => {
      setConstraintTab(key);
      const c = HSL_CONSTRAINTS[key];

      setHue((prev) => {
        const clamped = clamp(prev, c.hMin, c.hMax);
        return clamped !== prev ? mid(c.hMin, c.hMax) : prev;
      });
      setSat((prev) => {
        const clamped = clamp(prev, c.sMin, c.sMax);
        return clamped !== prev ? mid(c.sMin, c.sMax) : prev;
      });
      setLit((prev) => {
        const clamped = clamp(prev, c.lMin, c.lMax);
        return clamped !== prev ? mid(c.lMin, c.lMax) : prev;
      });
    },
    [],
  );

  // Handle hex input change (user typing)
  const handleHexInputChange = useCallback(
    (value: string) => {
      setHexInput(value);
      const trimmed = value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
        const [h, s, l] = hexToHsl(trimmed);
        setHue(clamp(h, constraints.hMin, constraints.hMax));
        setSat(clamp(s, constraints.sMin, constraints.sMax));
        setLit(clamp(l, constraints.lMin, constraints.lMax));
      }
    },
    [constraints],
  );

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, setOpen]);

  // Close on click outside panel (e.g., clicking on canvas)
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Don't close if clicking inside the panel itself
      if (panelRef.current?.contains(target)) return;
      // Don't close if clicking the sidebar's "+" button (it toggles via its own handler)
      const addBtn = document.querySelector('[aria-label="Add a custom color"]');
      if (addBtn?.contains(target)) return;
      // Don't close if clicking inside the sidebar (let users pick preset swatches while panel is open)
      const sidebar = (target as Element)?.closest?.('aside');
      if (sidebar) return;
      // Clicking anywhere else (canvas, header, right sidebar, etc.) closes
      setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen, setOpen]);

  // Also close when sidebar closes
  useEffect(() => {
    if (!sidebarOpen && isOpen) {
      setOpen(false);
    }
  }, [sidebarOpen, isOpen, setOpen]);

  if (!isOpen) return null;

  const previewColor = hslToHex(hue, sat, lit);

  // Gradients for slider tracks
  const hueGradient = `linear-gradient(to right, ${
    Array.from({ length: 13 }, (_, i) => {
      const h = (i / 12) * 360;
      return `hsl(${h}, 100%, 50%)`;
    }).join(', ')
  })`;
  const satGradient = `linear-gradient(to right, hsl(${hue}, ${constraints.sMin}%, ${lit}%), hsl(${hue}, ${constraints.sMax}%, ${lit}%))`;
  const litGradient = `linear-gradient(to right, hsl(${hue}, ${sat}%, ${constraints.lMin}%), hsl(${hue}, ${sat}%, ${constraints.lMax}%))`;

  return (
    <div className={styles.panel} ref={panelRef}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Custom Color</span>
        <button
          className={styles.doneButton}
          onClick={() => setOpen(false)}
        >
          Done
        </button>
      </div>

      {/* Constraint tabs */}
      <div className={styles.constraintTabs}>
        {CONSTRAINT_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`${styles.constraintTab} ${
              constraintTab === tab.key ? styles.activeConstraintTab : ''
            }`}
            onClick={() => handleConstraintTabChange(tab.key)}
            title={tab.key === 'none' ? 'Unconstrained' : tab.label}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Preview swatch */}
      <div className={styles.previewRow}>
        <div
          className={styles.previewSwatch}
          style={{ backgroundColor: previewColor }}
        />
        <span className={styles.previewHex}>{previewColor}</span>
      </div>

      {/* HSL Sliders */}
      <div className={styles.sliderGroup}>
        <label className={styles.sliderLabel}>
          <span className={styles.sliderName}>H</span>
          <input
            type="range"
            min={constraints.hMin}
            max={constraints.hMax}
            value={hue}
            onChange={(e) => setHue(Number(e.target.value))}
            className={styles.slider}
            style={{ background: hueGradient }}
          />
          <span className={styles.sliderValue}>{hue}</span>
        </label>

        <label className={styles.sliderLabel}>
          <span className={styles.sliderName}>S</span>
          <input
            type="range"
            min={constraints.sMin}
            max={constraints.sMax}
            value={sat}
            onChange={(e) => setSat(Number(e.target.value))}
            className={styles.slider}
            style={{ background: satGradient }}
          />
          <span className={styles.sliderValue}>{sat}</span>
        </label>

        <label className={styles.sliderLabel}>
          <span className={styles.sliderName}>L</span>
          <input
            type="range"
            min={constraints.lMin}
            max={constraints.lMax}
            value={lit}
            onChange={(e) => setLit(Number(e.target.value))}
            className={styles.slider}
            style={{ background: litGradient }}
          />
          <span className={styles.sliderValue}>{lit}</span>
        </label>
      </div>

      {/* Hex input */}
      <div className={styles.hexRow}>
        <span className={styles.hexLabel}>Hex:</span>
        <input
          type="text"
          className={styles.hexInput}
          value={hexInput}
          onChange={(e) => handleHexInputChange(e.target.value)}
          maxLength={7}
          spellCheck={false}
        />
      </div>

      {/* Add Color button */}
      <button
        className={styles.addColorBtn}
        onClick={() => addCustomColor(previewColor)}
      >
        Add Color
      </button>
    </div>
  );
}
