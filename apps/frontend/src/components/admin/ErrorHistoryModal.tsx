import { useState, useEffect, useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import type { AIError } from './AdminDashboard';
import styles from './ErrorHistoryModal.module.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const AUTH_PARAMS = {
  authorizationParams: {
    audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
  },
};
const PAGE_SIZE = 20;

interface ErrorHistoryModalProps {
  onClose: () => void;
}

/**
 * Modal showing full paginated AI error history from the audit log.
 */
export function ErrorHistoryModal({ onClose }: ErrorHistoryModalProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [errors, setErrors] = useState<AIError[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchErrors = useCallback(async (offset: number, append: boolean) => {
    try {
      const token = await getAccessTokenSilently(AUTH_PARAMS);
      const res = await fetch(
        `${API_URL}/audit/ai-errors?limit=${PAGE_SIZE}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json() as { errors: AIError[]; total: number };

      if (append) {
        setErrors((prev) => [...prev, ...data.errors]);
      } else {
        setErrors(data.errors);
      }
      setTotal(data.total);
      setFetchError(null);
    } catch (err) {
      console.error('[ErrorHistoryModal] fetch error:', err);
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch errors');
    }
  }, [getAccessTokenSilently]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    fetchErrors(0, false).finally(() => setLoading(false));
  }, [fetchErrors]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    await fetchErrors(errors.length, true);
    setLoadingMore(false);
  };

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Close on backdrop click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const hasMore = errors.length < total;

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>
            AI Error History
            <span className={styles.headerSubtitle}>
              {total} error{total !== 1 ? 's' : ''} captured
            </span>
          </h2>
          <button className={styles.closeButton} onClick={onClose} title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.loading}>
              <div className={styles.spinner} />
            </div>
          ) : fetchError ? (
            <p className={styles.errorText}>{fetchError}</p>
          ) : errors.length === 0 ? (
            <p className={styles.empty}>No AI errors have been recorded.</p>
          ) : (
            <>
              {errors.map((err) => (
                <ErrorCard key={err.id} error={err} />
              ))}

              {hasMore && (
                <div className={styles.loadMore}>
                  <button
                    className={styles.loadMoreButton}
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? 'Loading...' : `Load more (${errors.length} of ${total})`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Error Card
// ============================================================

function ErrorCard({ error }: { error: AIError }) {
  const timestamp = new Date(error.timestamp);
  const formattedTime = timestamp.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className={styles.errorCard}>
      <div className={styles.errorCardTop}>
        <span className={styles.errorCardCode}>{error.errorCode}</span>
        <span className={styles.errorCardTimestamp}>{formattedTime}</span>
      </div>

      {error.errorMessage && (
        <div className={styles.errorCardMessage}>{error.errorMessage}</div>
      )}

      {error.command && (
        <div className={styles.errorCardCommand}>
          <div className={styles.errorCardCommandLabel}>User Command</div>
          {error.command}
        </div>
      )}

      <div className={styles.errorMeta}>
        {error.model && (
          <MetaItem label="Model" value={error.model} />
        )}
        <MetaItem label="Turns" value={String(error.turnsUsed)} />
        {error.operationCount > 0 && (
          <MetaItem label="Partial Ops" value={String(error.operationCount)} />
        )}
        {(error.inputTokens > 0 || error.outputTokens > 0) && (
          <MetaItem
            label="Tokens"
            value={`${error.inputTokens.toLocaleString()} in / ${error.outputTokens.toLocaleString()} out`}
          />
        )}
        {error.costCents > 0 && (
          <MetaItem label="Cost" value={`${error.costCents}\u00A2`} />
        )}
        {error.traceId && (
          <MetaItem label="Trace" value={error.traceId.slice(0, 12) + '...'} />
        )}
        <MetaItem label="Board" value={error.boardId.slice(0, 8) + '...'} />
        <MetaItem label="User" value={error.userId.slice(0, 16) + '...'} />
      </div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <span className={styles.errorMetaItem}>
      <span className={styles.errorMetaLabel}>{label}:</span>
      <span className={styles.errorMetaValue}>{value}</span>
    </span>
  );
}
