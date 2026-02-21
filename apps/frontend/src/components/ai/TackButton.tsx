import { useAIStore } from '../../stores/aiStore';
import styles from './TackButton.module.css';

/**
 * Tacky mascot button — fixed bottom-right corner.
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
          // Thumbtack / pushpin icon when closed
          <>
            {/* Flat round pin-head */}
            <circle cx="12" cy="6" r="4" />
            {/* Tapered body from head to bar */}
            <path d="M9 9.5L7.5 15h9L15 9.5" />
            {/* Pin spike */}
            <line x1="12" y1="15" x2="12" y2="22" />
          </>
        )}
      </svg>

      {/* Thinking indicator */}
      {isProcessing && <span className={styles.thinkingDot} />}
    </button>
  );
}
