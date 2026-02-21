import { useUIStore } from '../../stores/uiStore';
import { LineOptions } from './LineOptions';
import { TextOptions } from './TextOptions';
import styles from './ToolOptionsPanel.module.css';

/**
 * Contextual tool options panel that appears below the color picker.
 *
 * Shows:
 * - LineOptions when the line tool is active OR a line object is selected
 * - TextOptions when the text tool is active OR a text object is selected
 * - Nothing otherwise (returns null — vanishes)
 */
export function ToolOptionsPanel() {
  const activeTool = useUIStore((s) => s.activeTool);
  const selectedObjectTypes = useUIStore((s) => s.selectedObjectTypes);

  const showLineOptions =
    activeTool === 'line' ||
    selectedObjectTypes.includes('line');

  const showTextOptions =
    activeTool === 'text' ||
    selectedObjectTypes.includes('text');

  if (!showLineOptions && !showTextOptions) return null;

  return (
    <div className={styles.container}>
      {showLineOptions && <LineOptions />}
      {showTextOptions && <TextOptions />}
    </div>
  );
}
