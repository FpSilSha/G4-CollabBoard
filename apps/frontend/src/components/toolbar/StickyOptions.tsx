import { useUIStore } from '../../stores/uiStore';
import type { StickySizeKey } from 'shared';
import styles from './ShapeOptions.module.css'; // Reuse same layout styles

const SIZES: { key: StickySizeKey; label: string; title: string }[] = [
  { key: 'small', label: 'S', title: 'Small (150x150)' },
  { key: 'medium', label: 'M', title: 'Medium (200x200)' },
  { key: 'large', label: 'L', title: 'Large (300x300)' },
];

/**
 * Sticky note size picker -- appears when the Sticky tool is active.
 * Lets the user switch between small, medium, and large presets.
 */
export function StickyOptions() {
  const stickySize = useUIStore((s) => s.stickySize);
  const setStickySize = useUIStore((s) => s.setStickySize);

  return (
    <div className={styles.panel}>
      <span className={styles.label}>Size</span>
      <div className={styles.shapeRow}>
        {SIZES.map((s) => {
          const isActive = stickySize === s.key;
          return (
            <button
              key={s.key}
              className={`${styles.shapeBtn} ${isActive ? styles.active : ''}`}
              onClick={() => setStickySize(s.key)}
              title={s.title}
              aria-label={s.title}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
