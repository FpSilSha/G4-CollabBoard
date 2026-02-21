import { useAIStore } from '../../stores/aiStore';
import styles from './TackButton.module.css';

/**
 * Tack mascot button — fixed bottom-right corner.
 * Toggles the AI chat panel open/closed.
 * Shows a pulsing dot when the AI is processing.
 */
export function TackButton() {
  const isOpen = useAIStore((s) => s.isOpen);
  const toggleChat = useAIStore((s) => s.toggleChat);
  const isProcessing = useAIStore((s) => s.isProcessing);

  return (
    <button
      className={`${styles.tackButton} ${isOpen ? styles.open : ''}`}
      onClick={toggleChat}
      title={isOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
      aria-label={isOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
    >
      {/* Thumbtack SVG icon */}
      <svg className={styles.tackIcon} viewBox="0 0 24 24">
        {isOpen ? (
          // X close icon when open
          <>
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </>
        ) : (
          // Thumbtack icon when closed
          <path d="M12 2L9 9H4l3 5-2 8 7-4 7 4-2-8 3-5h-5L12 2z" />
        )}
      </svg>

      {/* Thinking indicator */}
      {isProcessing && <span className={styles.thinkingDot} />}
    </button>
  );
}
