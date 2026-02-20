import { useUIStore } from '../../stores/uiStore';
import { ClipboardIndicator } from '../ui/ClipboardIndicator';
import { TeleportFlagList } from '../ui/TeleportFlagList';
import styles from './RightSidebar.module.css';

/**
 * Collapsible right sidebar containing:
 *   1. Clipboard Indicator (top)
 *   2. Teleport Flags section (below)
 *
 * Mirrors the left sidebar collapse pattern — has an edge toggle lip
 * on the left edge. Collapsed by default.
 */
export function RightSidebar() {
  const isOpen = useUIStore((s) => s.rightSidebarOpen);
  const toggle = useUIStore((s) => s.toggleRightSidebar);

  const sidebarClass = isOpen
    ? styles.sidebar
    : `${styles.sidebar} ${styles.collapsed}`;

  return (
    <aside className={sidebarClass}>
      {/* Edge toggle lip — always visible, even when collapsed */}
      <button
        className={styles.edgeToggle}
        onClick={toggle}
        title={isOpen ? 'Collapse right panel' : 'Expand right panel'}
        aria-label={isOpen ? 'Collapse right panel' : 'Expand right panel'}
      >
        <svg width="10" height="14" viewBox="0 0 10 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {isOpen ? (
            <path d="M3 1l6 6-6 6" />
          ) : (
            <path d="M7 1L1 7l6 6" />
          )}
        </svg>
      </button>

      {isOpen && (
        <>
          {/* --- Clipboard Indicator --- */}
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Clipboard</div>
            <ClipboardIndicator />
          </div>

          {/* --- Teleport Flags --- */}
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Teleport Flags</div>
            <TeleportFlagList />
          </div>
        </>
      )}
    </aside>
  );
}
