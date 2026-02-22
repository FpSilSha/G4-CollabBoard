import { useUIStore } from '../../stores/uiStore';
import styles from './ClipboardIndicator.module.css';

/**
 * Displays clipboard history — up to 5 past copy operations (FIFO, newest first).
 *
 * - 0 entries: "Nothing copied" muted text
 * - 1+ entries: Vertical list with preview icons. Active entry highlighted.
 *   Clicking a non-active entry switches the active clipboard for the next paste.
 */
export function ClipboardIndicator() {
  const clipboardHistory = useUIStore((s) => s.clipboardHistory);
  const activeIndex = useUIStore((s) => s.activeClipboardIndex);
  const setActiveIndex = useUIStore((s) => s.setActiveClipboardIndex);

  if (clipboardHistory.length === 0) {
    return <div className={styles.empty}>Nothing copied</div>;
  }

  return (
    <div className={styles.historyList}>
      {clipboardHistory.map((entry, i) => {
        const isActive = i === activeIndex;
        const entryClass = isActive
          ? `${styles.historyEntry} ${styles.activeEntry}`
          : styles.historyEntry;

        return (
          <button
            key={i}
            className={entryClass}
            onClick={() => setActiveIndex(i)}
            title={isActive ? 'Active clipboard entry' : 'Click to make active'}
          >
            <EntryPreview objects={entry} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Renders a single clipboard history entry:
 * - 1 object: icon + type label
 * - 2+ objects: "N objects copied"
 */
function EntryPreview({ objects }: { objects: import('shared').BoardObject[] }) {
  if (objects.length === 0) {
    return <span className={styles.typeLabel}>Empty</span>;
  }

  if (objects.length === 1) {
    const obj = objects[0];
    return (
      <>
        <ObjectPreviewIcon
          type={obj.type}
          color={obj.color}
          shapeType={'shapeType' in obj ? obj.shapeType : undefined}
        />
        <span className={styles.typeLabel}>
          {getTypeLabel(obj.type, 'shapeType' in obj ? obj.shapeType : undefined)}
        </span>
        {obj.type === 'line' && <LineDetailBadges obj={obj} />}
      </>
    );
  }

  return (
    <span className={styles.typeLabel}>
      {objects.length} objects
    </span>
  );
}

function getTypeLabel(type: string, shapeType?: string): string {
  switch (type) {
    case 'sticky': return 'Sticky note';
    case 'shape':
      if (shapeType === 'circle') return 'Circle';
      if (shapeType === 'arrow') return 'Arrow';
      if (shapeType === 'star') return 'Star';
      if (shapeType === 'line') return 'Line';
      return 'Rectangle';
    case 'frame': return 'Frame';
    case 'connector': return 'Connector';
    case 'line': return 'Line';
    case 'text': return 'Text';
    default: return 'Object';
  }
}

function ObjectPreviewIcon({ type, color, shapeType }: { type: string; color: string; shapeType?: string }) {
  const size = 20;
  const fill = color || '#888888';

  switch (type) {
    case 'sticky':
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <rect x="2" y="2" width="16" height="16" rx="2" fill={fill} />
          <line x1="5" y1="7" x2="15" y2="7" stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
          <line x1="5" y1="10" x2="12" y2="10" stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
        </svg>
      );
    case 'shape':
      if (shapeType === 'circle') {
        return (
          <svg width={size} height={size} viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" fill={fill} />
          </svg>
        );
      }
      if (shapeType === 'arrow') {
        return (
          <svg width={size} height={size} viewBox="0 0 20 20">
            <polygon points="2,8 12,8 12,4 18,10 12,16 12,12 2,12" fill={fill} />
          </svg>
        );
      }
      if (shapeType === 'star') {
        return (
          <svg width={size} height={size} viewBox="0 0 20 20">
            <polygon points="10,1 12.5,7 19,7.5 14,12 15.5,18.5 10,15 4.5,18.5 6,12 1,7.5 7.5,7" fill={fill} />
          </svg>
        );
      }
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <rect x="2" y="2" width="16" height="16" fill={fill} />
        </svg>
      );
    case 'frame':
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <rect x="2" y="2" width="16" height="16" rx="1" fill="none" stroke={fill} strokeWidth="2" strokeDasharray="4 2" />
        </svg>
      );
    case 'connector':
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <line x1="3" y1="17" x2="17" y2="3" stroke={fill} strokeWidth="2" />
        </svg>
      );
    case 'line':
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <line x1="3" y1="17" x2="17" y2="3" stroke={fill} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'text':
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <text x="4" y="15" fontSize="14" fontWeight="bold" fill={fill}>T</text>
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <rect x="2" y="2" width="16" height="16" rx="2" fill={fill} />
        </svg>
      );
  }
}

/**
 * Small inline badges next to "Line" label showing active styling.
 * Only renders badges for non-default properties. Only shown for single-line copies.
 */
function LineDetailBadges({ obj }: { obj: import('shared').BoardObject }) {
  if (obj.type !== 'line') return null;
  const lineObj = obj as import('shared').Line;

  const badges: React.ReactNode[] = [];

  // Bold badge
  if (lineObj.strokeWeight === 'bold') {
    badges.push(
      <span key="bold" className={styles.lineBadge} title="Bold">
        <svg width="14" height="10" viewBox="0 0 14 10">
          <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  // Arrowhead badge
  if (lineObj.endpointStyle === 'arrow-end') {
    badges.push(
      <span key="arrow" className={styles.lineBadge} title="Arrow">
        <svg width="14" height="10" viewBox="0 0 14 10">
          <line x1="1" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <polyline points="8,2 12,5 8,8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  } else if (lineObj.endpointStyle === 'arrow-both') {
    badges.push(
      <span key="arrow-both" className={styles.lineBadge} title="Arrows both">
        <svg width="14" height="10" viewBox="0 0 14 10">
          <line x1="4" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" />
          <polyline points="6,2 2,5 6,8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="8,2 12,5 8,8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  // Double/triple badge
  if (lineObj.strokeWeight === 'double') {
    badges.push(
      <span key="double" className={styles.lineBadge} title="Double">
        <svg width="14" height="10" viewBox="0 0 14 10">
          <line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  } else if (lineObj.strokeWeight === 'triple') {
    badges.push(
      <span key="triple" className={styles.lineBadge} title="Triple">
        <svg width="14" height="10" viewBox="0 0 14 10">
          <line x1="1" y1="2" x2="13" y2="2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <line x1="1" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  // Dashed badge
  if (lineObj.strokePattern === 'dashed') {
    badges.push(
      <span key="dashed" className={styles.lineBadge} title="Dashed">
        <svg width="14" height="10" viewBox="0 0 14 10">
          <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2" />
        </svg>
      </span>
    );
  }

  if (badges.length === 0) return null;

  return <span className={styles.lineBadges}>{badges}</span>;
}
