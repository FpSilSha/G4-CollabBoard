import { useUIStore } from '../../stores/uiStore';
import styles from './Toast.module.css';

/**
 * Ephemeral toast notification that appears at the top-center of the viewport.
 * Automatically dismisses after 3 seconds (controlled by uiStore.showToast).
 * Renders nothing when there is no active toast message.
 */
export function Toast() {
  const message = useUIStore((s) => s.toastMessage);

  if (!message) return null;

  return (
    <div className={styles.toast}>
      {message}
    </div>
  );
}
