import type { ReactNode } from 'react';
import styles from './MetricTile.module.css';

interface MetricTileProps {
  label: string;
  value: string;
  subtitle?: string;
  tooltip?: string;
  wide?: boolean;
  /** When true, renders content only (no card border/shadow). Used inside FlippableTile. */
  bare?: boolean;
  children?: ReactNode;
}

/**
 * Reusable metric card for the admin dashboard.
 * Shows a label, large value, optional subtitle, and optional custom content.
 */
export function MetricTile({ label, value, subtitle, tooltip, wide, bare, children }: MetricTileProps) {
  const cls = bare
    ? styles.tileBare
    : `${styles.tile} ${wide ? styles.wide : ''}`;

  return (
    <div className={cls} title={tooltip}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      {children && <div className={styles.content}>{children}</div>}
    </div>
  );
}
