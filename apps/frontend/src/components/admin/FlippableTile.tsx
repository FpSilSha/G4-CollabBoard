import { useState, type ReactNode } from 'react';
import styles from './FlippableTile.module.css';

interface FlippableTileProps {
  /** Front face content */
  front: ReactNode;
  /** Back face content */
  back: ReactNode;
  /** Whether the flip arrow should be shown (e.g. false when no per-model data) */
  canFlip?: boolean;
}

/**
 * A card that flips between front and back with a CSS 3D animation.
 * A small arrow in the corner triggers the flip.
 */
export function FlippableTile({ front, back, canFlip = true }: FlippableTileProps) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className={styles.container}>
      <div className={`${styles.card} ${flipped ? styles.flipped : ''}`}>
        {/* Front face */}
        <div className={styles.face}>
          {front}
          {canFlip && (
            <button
              className={styles.flipButton}
              onClick={() => setFlipped(true)}
              title="Show per-model breakdown"
              aria-label="Show per-model breakdown"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>

        {/* Back face */}
        <div className={`${styles.face} ${styles.backFace}`}>
          {back}
          <button
            className={styles.flipButton}
            onClick={() => setFlipped(false)}
            title="Back to overview"
            aria-label="Back to overview"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
