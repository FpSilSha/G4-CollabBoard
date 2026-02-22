import { useEffect, useRef } from 'react';
import { fabric } from 'fabric';
import { useUIStore } from '../../stores/uiStore';
import { useBoardStore } from '../../stores/boardStore';
import { DEFAULT_SYSTEM_FONT } from '../../utils/fabricHelpers';
import styles from './TextOptions.module.css';

/** Web-safe fonts with display labels. */
const WEB_SAFE_FONTS = [
  { label: 'System', family: DEFAULT_SYSTEM_FONT },
  { label: 'Arial', family: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', family: 'Georgia, serif' },
  { label: 'Times', family: '"Times New Roman", Times, serif' },
  { label: 'Courier', family: '"Courier New", Courier, monospace' },
  { label: 'Verdana', family: 'Verdana, Geneva, sans-serif' },
  { label: 'Impact', family: 'Impact, "Arial Narrow Bold", sans-serif' },
  { label: 'Comic Sans', family: '"Comic Sans MS", "Comic Sans", cursive' },
  { label: 'Trebuchet', family: '"Trebuchet MS", Helvetica, sans-serif' },
  { label: 'Palatino', family: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
];

/**
 * Text tool options panel: font size and font family selector.
 *
 * - Updates uiStore text styling state (persists between draws)
 * - If a text element is selected, applies changes immediately and syncs via WS
 * - On selection change, populates options from the selected text's properties
 */
export function TextOptions() {
  const fontSize = useUIStore((s) => s.textFontSize);
  const fontFamily = useUIStore((s) => s.textFontFamily);
  const setFontSize = useUIStore((s) => s.setTextFontSize);
  const setFontFamily = useUIStore((s) => s.setTextFontFamily);
  const selectedObjectIds = useUIStore((s) => s.selectedObjectIds);
  const selectedObjectTypes = useUIStore((s) => s.selectedObjectTypes);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Populate options from selected text element on selection change
  useEffect(() => {
    if (selectedObjectTypes.length !== 1 || selectedObjectTypes[0] !== 'text') return;
    if (selectedObjectIds.length !== 1) return;

    const canvas = useBoardStore.getState().canvas;
    if (!canvas) return;

    const fabricObj = canvas.getObjects().find(
      (o) => o.data?.id === selectedObjectIds[0]
    );
    if (!fabricObj || fabricObj.data?.type !== 'text') return;

    const textObj = fabricObj as fabric.IText;
    if (textObj.fontSize) setFontSize(textObj.fontSize);
    if (textObj.fontFamily) setFontFamily(textObj.fontFamily);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedObjectIds]);

  /** Apply changes to the selected text element (if any). */
  const applyToSelectedText = (props: { fontSize?: number; fontFamily?: string }) => {
    if (selectedObjectTypes.length !== 1 || selectedObjectTypes[0] !== 'text') return;
    if (selectedObjectIds.length !== 1) return;

    const canvas = useBoardStore.getState().canvas;
    if (!canvas) return;

    const fabricObj = canvas.getObjects().find(
      (o) => o.data?.id === selectedObjectIds[0]
    );
    if (!fabricObj || fabricObj.data?.type !== 'text') return;

    const textObj = fabricObj as fabric.IText;
    if (props.fontSize !== undefined) textObj.set('fontSize', props.fontSize);
    if (props.fontFamily !== undefined) textObj.set('fontFamily', props.fontFamily);
    canvas.requestRenderAll();

    // Fire object:modified for sync
    canvas.fire('object:modified', { target: fabricObj });
  };

  const handleFontSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 1 || val > 200) return;
    // Store whatever the user types; only apply to canvas if >= 8
    setFontSize(val);
    if (val >= 8) {
      applyToSelectedText({ fontSize: val });
    }
  };

  /** On blur or Enter, clamp values below 8 up to 8 and apply. */
  const handleFontSizeBlur = () => {
    if (fontSize < 8) {
      setFontSize(8);
      applyToSelectedText({ fontSize: 8 });
    }
  };

  const handleFontSizeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  const handleFontFamilyClick = (family: string) => {
    setFontFamily(family);
    applyToSelectedText({ fontFamily: family });
  };

  return (
    <div className={styles.panel}>
      {/* Font Size row */}
      <div className={styles.optionRow}>
        <span className={styles.label}>Size</span>
        <input
          type="number"
          className={styles.sizeInput}
          value={fontSize}
          onChange={handleFontSizeChange}
          onBlur={handleFontSizeBlur}
          onKeyDown={handleFontSizeKeyDown}
          min={1}
          max={200}
          step={1}
          title="Font size (min 8)"
        />
      </div>

      {/* Font Family row — horizontally scrollable */}
      <div className={styles.optionRow}>
        <span className={styles.label}>Font</span>
        <div className={styles.fontScroll} ref={scrollRef}>
          {WEB_SAFE_FONTS.map((font) => {
            const isActive = fontFamily === font.family;
            return (
              <button
                key={font.label}
                className={`${styles.fontBtn} ${isActive ? styles.active : ''}`}
                onClick={() => handleFontFamilyClick(font.family)}
                title={font.label}
                style={{ fontFamily: font.family }}
              >
                Aa
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
