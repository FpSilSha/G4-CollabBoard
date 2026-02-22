import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import type { AICommandResponse, AIStatusResponse, AIOperation } from 'shared';
import { useAIStore, nextMessageId } from '../../stores/aiStore';
import { useBoardStore } from '../../stores/boardStore';
import styles from './AIChatPanel.module.css';

// ============================================================
// AI Chat Panel — floating modal for board AI assistant
// ============================================================

/**
 * Get the current viewport bounds from the Fabric.js canvas.
 * Returns the board-coordinate rectangle of what the user can see.
 */
function getViewportBounds() {
  const canvas = useBoardStore.getState().canvas;
  if (!canvas) {
    return { x: 0, y: 0, width: 1920, height: 1080, zoom: 1 };
  }

  const vpt = canvas.viewportTransform;
  if (!vpt) {
    return { x: 0, y: 0, width: 1920, height: 1080, zoom: 1 };
  }

  const zoom = canvas.getZoom();
  const canvasWidth = canvas.getWidth();
  const canvasHeight = canvas.getHeight();

  return {
    x: -vpt[4] / zoom,
    y: -vpt[5] / zoom,
    width: canvasWidth / zoom,
    height: canvasHeight / zoom,
    zoom,
  };
}

export function AIChatPanel() {
  const isOpen = useAIStore((s) => s.isOpen);
  const messages = useAIStore((s) => s.messages);
  const isProcessing = useAIStore((s) => s.isProcessing);
  const aiEnabled = useAIStore((s) => s.aiEnabled);
  const addMessage = useAIStore((s) => s.addMessage);
  const setProcessing = useAIStore((s) => s.setProcessing);
  const handleResponse = useAIStore((s) => s.handleResponse);
  const setStatus = useAIStore((s) => s.setStatus);
  const setOpen = useAIStore((s) => s.setOpen);

  const boardId = useBoardStore((s) => s.boardId);
  const { getAccessTokenSilently } = useAuth0();

  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const statusFetchedRef = useRef(false);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Fetch AI status on first open
  useEffect(() => {
    if (!isOpen || statusFetchedRef.current) return;
    statusFetchedRef.current = true;

    async function fetchStatus() {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const token = await getAccessTokenSilently({
          authorizationParams: {
            audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
          },
        });

        const res = await fetch(`${apiUrl}/ai/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data: AIStatusResponse = await res.json();
          setStatus(data);
        }
      } catch {
        // Non-fatal — keep optimistic defaults
      }
    }

    fetchStatus();
  }, [isOpen, getAccessTokenSilently, setStatus]);

  // Send command
  const handleSend = useCallback(async () => {
    const command = inputValue.trim();
    if (!command || !boardId || isProcessing) return;

    // Add user message
    addMessage({
      id: nextMessageId(),
      role: 'user',
      content: command,
      timestamp: new Date(),
    });

    // Add placeholder assistant message
    addMessage({
      id: nextMessageId(),
      role: 'assistant',
      content: 'Thinking...',
      timestamp: new Date(),
      isLoading: true,
    });

    setInputValue('');
    setProcessing(true);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const token = await getAccessTokenSilently({
        authorizationParams: {
          audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
        },
      });

      const viewport = getViewportBounds();

      const res = await fetch(`${apiUrl}/ai/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          boardId,
          command,
          viewport,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        const errorMsg = errorData?.error?.message || errorData?.message || `Server error (${res.status})`;
        useAIStore.getState().updateLastAssistantMessage(errorMsg);
        setProcessing(false);
        return;
      }

      const data: AICommandResponse = await res.json();
      handleResponse(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reach the server';
      useAIStore.getState().updateLastAssistantMessage(message);
      setProcessing(false);
    }
  }, [inputValue, boardId, isProcessing, addMessage, setProcessing, handleResponse, getAccessTokenSilently]);

  // Enter to send (Shift+Enter for newline)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  if (!isOpen) return null;

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>Tacky - AI Assistant</span>
        <button
          className={styles.closeButton}
          onClick={() => setOpen(false)}
          title="Close"
          aria-label="Close AI chat panel"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className={styles.messages}>
        {!aiEnabled ? (
          <div className={styles.disabledBanner}>
            AI features are currently disabled.
          </div>
        ) : messages.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyTitle}>Hi, I'm Tacky!</div>
            <div className={styles.emptyHint}>
              I can create sticky notes, shapes, frames, and more.
              Try: "Create a SWOT analysis template" or "Add 5 blue sticky notes with project ideas"
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isError = msg.error || (!msg.isLoading && msg.role === 'assistant' && msg.content.startsWith('Server error'));
            const className = msg.role === 'user'
              ? styles.messageUser
              : msg.isLoading
                ? styles.messageLoading
                : isError
                  ? styles.messageError
                  : styles.messageAssistant;

            return (
              <div key={msg.id} className={className}>
                {msg.content}
                {msg.operations && msg.operations.length > 0 && (
                  <OpsBadge operations={msg.operations} />
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {aiEnabled && (
        <div className={styles.inputArea}>
          <textarea
            ref={inputRef}
            className={styles.input}
            placeholder="Ask Tacky to create or modify objects..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isProcessing}
            rows={1}
            maxLength={1000}
          />
          <button
            className={styles.sendButton}
            onClick={handleSend}
            disabled={isProcessing || !inputValue.trim()}
          >
            {isProcessing ? '...' : 'Send'}
          </button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Expandable Operations Badge
// ────────────────────────────────────────────────────────────

function OpsBadge({ operations }: { operations: AIOperation[] }) {
  const [expanded, setExpanded] = useState(false);
  const count = operations.length;

  return (
    <div className={styles.opsContainer}>
      <button
        className={styles.opsBadge}
        onClick={() => setExpanded(!expanded)}
        title={expanded ? 'Collapse operations' : 'Expand operations'}
      >
        <span>{count} operation{count !== 1 ? 's' : ''}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          className={expanded ? styles.opsChevronUp : styles.opsChevronDown}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {expanded && (
        <div className={styles.opsDetails}>
          {operations.map((op, i) => (
            <div key={i} className={styles.opsRow}>
              <span className={styles.opsType}>{op.type}</span>
              <span className={styles.opsTarget}>
                {op.objectType || 'object'}
                {op.count && op.count > 1 ? ` ×${op.count}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
