import { useUIStore } from '../../stores/uiStore';
import { LineOptions } from './LineOptions';
import { TextOptions } from './TextOptions';
import { ShapeOptions } from './ShapeOptions';
import { StickyOptions } from './StickyOptions';
import styles from './ToolOptionsPanel.module.css';

/** Shape tool names that show the ShapeOptions panel. */
const SHAPE_TOOLS = new Set(['rectangle', 'circle', 'triangle', 'star', 'arrow', 'diamond']);

/**
 * Contextual tool options panel that appears below the color picker.
 *
 * Shows:
 * - StickyOptions when the sticky tool is active
 * - ShapeOptions when a shape tool is active
 * - LineOptions when the line tool is active OR a line object is selected
 * - TextOptions when the text tool is active OR a text object is selected
 * - Nothing otherwise (returns null — vanishes)
 */
export function ToolOptionsPanel() {
  const activeTool = useUIStore((s) => s.activeTool);
  const selectedObjectTypes = useUIStore((s) => s.selectedObjectTypes);

  const showStickyOptions = activeTool === 'sticky';

  const showShapeOptions = SHAPE_TOOLS.has(activeTool);

  const showLineOptions =
    activeTool === 'line' ||
    selectedObjectTypes.includes('line');

  const showTextOptions =
    activeTool === 'text' ||
    selectedObjectTypes.includes('text');

  if (!showStickyOptions && !showShapeOptions && !showLineOptions && !showTextOptions) return null;

  return (
    <div className={styles.container}>
      {showStickyOptions && <StickyOptions />}
      {showShapeOptions && <ShapeOptions />}
      {showLineOptions && <LineOptions />}
      {showTextOptions && <TextOptions />}
    </div>
  );
}
