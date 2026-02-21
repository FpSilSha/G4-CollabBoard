import { useEffect } from 'react';
import type { LineEndpointStyle, LineStrokePattern, LineStrokeWeight } from 'shared';
import { useUIStore } from '../../stores/uiStore';
import { useBoardStore } from '../../stores/boardStore';
import styles from './LineOptions.module.css';

/**
 * Line tool options panel: endpoint style, stroke pattern, and stroke weight.
 *
 * - Updates uiStore line styling state (persists between draws)
 * - If a line is currently selected, applies changes immediately and syncs via WS
 * - On selection change, populates options from the selected line's data
 */
export function LineOptions() {
  const endpointStyle = useUIStore((s) => s.lineEndpointStyle);
  const strokePattern = useUIStore((s) => s.lineStrokePattern);
  const strokeWeight = useUIStore((s) => s.lineStrokeWeight);
  const setEndpointStyle = useUIStore((s) => s.setLineEndpointStyle);
  const setStrokePattern = useUIStore((s) => s.setLineStrokePattern);
  const setStrokeWeight = useUIStore((s) => s.setLineStrokeWeight);
  const selectedObjectIds = useUIStore((s) => s.selectedObjectIds);
  const selectedObjectTypes = useUIStore((s) => s.selectedObjectTypes);

  // Populate options from selected line on selection change
  useEffect(() => {
    if (selectedObjectTypes.length !== 1 || selectedObjectTypes[0] !== 'line') return;
    if (selectedObjectIds.length !== 1) return;

    const canvas = useBoardStore.getState().canvas;
    if (!canvas) return;

    const fabricObj = canvas.getObjects().find(
      (o) => o.data?.id === selectedObjectIds[0]
    );
    if (!fabricObj || fabricObj.data?.type !== 'line') return;

    // Read styling from the Fabric object's data
    const data = fabricObj.data;
    if (data.endpointStyle) setEndpointStyle(data.endpointStyle as LineEndpointStyle);
    if (data.strokePattern) setStrokePattern(data.strokePattern as LineStrokePattern);
    if (data.strokeWeight) setStrokeWeight(data.strokeWeight as LineStrokeWeight);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedObjectIds]);

  /** Apply a styling change to the selected line (if any) and emit to server. */
  const applyToSelectedLine = (updates: Record<string, unknown>) => {
    if (selectedObjectTypes.length !== 1 || selectedObjectTypes[0] !== 'line') return;
    if (selectedObjectIds.length !== 1) return;

    const canvas = useBoardStore.getState().canvas;
    if (!canvas) return;

    const fabricObj = canvas.getObjects().find(
      (o) => o.data?.id === selectedObjectIds[0]
    );
    if (!fabricObj || fabricObj.data?.type !== 'line') return;

    // Update Fabric object data
    Object.assign(fabricObj.data, updates);
    fabricObj.dirty = true;
    canvas.requestRenderAll();

    // Trigger object:modified to sync via existing useCanvasSync pipeline
    canvas.fire('object:modified', { target: fabricObj });
  };

  const handleEndpointStyle = (style: LineEndpointStyle) => {
    setEndpointStyle(style);
    applyToSelectedLine({ endpointStyle: style });
  };

  const handleStrokePattern = (pattern: LineStrokePattern) => {
    setStrokePattern(pattern);
    applyToSelectedLine({ strokePattern: pattern });
  };

  const handleStrokeWeight = (weight: LineStrokeWeight) => {
    setStrokeWeight(weight);
    applyToSelectedLine({ strokeWeight: weight });
  };

  return (
    <div className={styles.panel}>
      {/* Endpoints row */}
      <div className={styles.optionRow}>
        <span className={styles.label}>Endpoints</span>
        <div className={styles.buttonRow}>
          <button
            className={`${styles.optionBtn} ${endpointStyle === 'none' ? styles.active : ''}`}
            onClick={() => handleEndpointStyle('none')}
            title="No arrowheads"
            aria-label="No arrowheads"
          >
            <EndpointNoneIcon />
          </button>
          <button
            className={`${styles.optionBtn} ${endpointStyle === 'arrow-end' ? styles.active : ''}`}
            onClick={() => handleEndpointStyle('arrow-end')}
            title="Arrow at end"
            aria-label="Arrow at end"
          >
            <EndpointArrowEndIcon />
          </button>
          <button
            className={`${styles.optionBtn} ${endpointStyle === 'arrow-both' ? styles.active : ''}`}
            onClick={() => handleEndpointStyle('arrow-both')}
            title="Arrows at both ends"
            aria-label="Arrows at both ends"
          >
            <EndpointArrowBothIcon />
          </button>
        </div>
      </div>

      {/* Pattern row */}
      <div className={styles.optionRow}>
        <span className={styles.label}>Pattern</span>
        <div className={styles.buttonRow}>
          <button
            className={`${styles.optionBtn} ${strokePattern === 'solid' ? styles.active : ''}`}
            onClick={() => handleStrokePattern('solid')}
            title="Solid line"
            aria-label="Solid line"
          >
            <PatternSolidIcon />
          </button>
          <button
            className={`${styles.optionBtn} ${strokePattern === 'dashed' ? styles.active : ''}`}
            onClick={() => handleStrokePattern('dashed')}
            title="Dashed line"
            aria-label="Dashed line"
          >
            <PatternDashedIcon />
          </button>
        </div>
      </div>

      {/* Weight row */}
      <div className={styles.optionRow}>
        <span className={styles.label}>Weight</span>
        <div className={styles.buttonRow}>
          <button
            className={`${styles.optionBtn} ${strokeWeight === 'normal' ? styles.active : ''}`}
            onClick={() => handleStrokeWeight('normal')}
            title="Normal weight"
            aria-label="Normal weight"
          >
            <WeightNormalIcon />
          </button>
          <button
            className={`${styles.optionBtn} ${strokeWeight === 'bold' ? styles.active : ''}`}
            onClick={() => handleStrokeWeight('bold')}
            title="Bold weight"
            aria-label="Bold weight"
          >
            <WeightBoldIcon />
          </button>
          <button
            className={`${styles.optionBtn} ${strokeWeight === 'double' ? styles.active : ''}`}
            onClick={() => handleStrokeWeight('double')}
            title="Double line"
            aria-label="Double line"
          >
            <WeightDoubleIcon />
          </button>
          <button
            className={`${styles.optionBtn} ${strokeWeight === 'triple' ? styles.active : ''}`}
            onClick={() => handleStrokeWeight('triple')}
            title="Triple line"
            aria-label="Triple line"
          >
            <WeightTripleIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Endpoint Style Icons
// ============================================================

function EndpointNoneIcon() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="8" x2="24" y2="8" />
    </svg>
  );
}

function EndpointArrowEndIcon() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="8" x2="20" y2="8" />
      <polyline points="17,4 23,8 17,12" />
    </svg>
  );
}

function EndpointArrowBothIcon() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="8" x2="20" y2="8" />
      <polyline points="11,4 5,8 11,12" />
      <polyline points="17,4 23,8 17,12" />
    </svg>
  );
}

// ============================================================
// Stroke Pattern Icons
// ============================================================

function PatternSolidIcon() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="8" x2="24" y2="8" />
    </svg>
  );
}

function PatternDashedIcon() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 3">
      <line x1="4" y1="8" x2="24" y2="8" />
    </svg>
  );
}

// ============================================================
// Stroke Weight Icons
// ============================================================

function WeightNormalIcon() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeLinecap="round">
      <line x1="4" y1="8" x2="24" y2="8" strokeWidth="2" />
    </svg>
  );
}

function WeightBoldIcon() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeLinecap="round">
      <line x1="4" y1="8" x2="24" y2="8" strokeWidth="4" />
    </svg>
  );
}

function WeightDoubleIcon() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="5" x2="24" y2="5" />
      <line x1="4" y1="11" x2="24" y2="11" />
    </svg>
  );
}

function WeightTripleIcon() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="4" y1="4" x2="24" y2="4" />
      <line x1="4" y1="8" x2="24" y2="8" />
      <line x1="4" y1="12" x2="24" y2="12" />
    </svg>
  );
}
