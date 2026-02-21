import type { ReactNode } from 'react';
import styles from './MetricTile.module.css';

interface MetricTileProps {
  label: string;
  value: string;
  subtitle?: string;
  wide?: boolean;
  children?: ReactNode;
}

/**
 * Reusable metric card for the admin dashboard.
 * Shows a label, large value, optional subtitle, and optional custom content.
 */
export function MetricTile({ label, value, subtitle, wide, children }: MetricTileProps) {
  return (
    <div className={`${styles.tile} ${wide ? styles.wide : ''}`}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      {children && <div className={styles.content}>{children}</div>}
    </div>
  );
}
