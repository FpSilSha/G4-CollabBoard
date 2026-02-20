import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import styles from './Dashboard.module.css';

interface BoardSummary {
  id: string;
  title: string;
  slot: number;
  lastAccessedAt: string;
  objectCount: number;
  isDeleted: boolean;
}

interface BoardListResponse {
  boards: BoardSummary[];
  slots: { used: number; total: number; tier: string };
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const AUTH_PARAMS = {
  authorizationParams: {
    audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
  },
};

/**
 * Dashboard page at "/".
 *
 * Shows the current user's boards as clickable cards.
 * Each card links to /board/:boardId for the canvas view.
 * "New Board" creates one via POST /boards and navigates to it.
 *
 * No auto-creation — user explicitly clicks "New Board".
 * This eliminates the React StrictMode double-creation bug
 * that the old auto-create useEffect had.
 */
export function Dashboard() {
  const { getAccessTokenSilently, logout, user } = useAuth0();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [slots, setSlots] = useState<{ used: number; total: number; tier: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Board rename on dashboard ---
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // --- Board delete on dashboard ---
  const [deletingBoardId, setDeletingBoardId] = useState<string | null>(null);

  // Fetch boards on mount. The cancelled flag prevents stale updates
  // if the component unmounts before the fetch resolves.
  // In StrictMode: effect runs → cleanup (cancelled=true) → effect re-runs.
  // The second run gets its own cancelled=false and completes normally.
  useEffect(() => {
    let cancelled = false;

    async function fetchBoards() {
      try {
        const token = await getAccessTokenSilently(AUTH_PARAMS);
        const res = await fetch(`${API_URL}/boards`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data: BoardListResponse = await res.json();
        if (!cancelled) {
          setBoards(data.boards.filter((b) => !b.isDeleted));
          setSlots(data.slots);
        }
      } catch (err) {
        console.error('[Dashboard] fetchBoards error:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load boards');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchBoards();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateBoard = async () => {
    setCreating(true);
    setError(null);
    try {
      const token = await getAccessTokenSilently(AUTH_PARAMS);
      const res = await fetch(`${API_URL}/boards`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Untitled Board' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to create board');
      }
      const created = await res.json();

      // Add the new board to the list and update slot count
      const newBoard: BoardSummary = {
        id: created.id,
        title: created.title ?? 'Untitled Board',
        slot: created.slot ?? (slots ? slots.used + 1 : 1),
        lastAccessedAt: new Date().toISOString(),
        objectCount: 0,
        isDeleted: false,
      };
      setBoards((prev) => [...prev, newBoard]);
      setSlots((prev) => prev ? { ...prev, used: prev.used + 1 } : prev);

      // Auto-focus the title field on the new card for immediate rename
      setRenameDraft('');
      setRenamingBoardId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create board');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (renamingBoardId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingBoardId]);

  const handleRenameBoard = async (boardId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    const finalTitle = trimmed || 'Untitled Board';
    setRenamingBoardId(null);

    // Optimistic update
    setBoards((prev) =>
      prev.map((b) => (b.id === boardId ? { ...b, title: finalTitle } : b))
    );

    try {
      const token = await getAccessTokenSilently(AUTH_PARAMS);
      await fetch(`${API_URL}/boards/${boardId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: finalTitle }),
      });
    } catch (err) {
      console.error('[Dashboard] Failed to rename board:', err);
    }
  };

  const handleDeleteBoard = async (boardId: string) => {
    // Optimistic removal from list
    setBoards((prev) => prev.filter((b) => b.id !== boardId));
    setSlots((prev) => prev ? { ...prev, used: Math.max(0, prev.used - 1) } : prev);
    setDeletingBoardId(null);

    try {
      const token = await getAccessTokenSilently(AUTH_PARAMS);
      const res = await fetch(`${API_URL}/boards/${boardId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.error('[Dashboard] Failed to delete board:', res.status);
      }
    } catch (err) {
      console.error('[Dashboard] Failed to delete board:', err);
    }
  };

  const handleLogout = () => {
    logout({ logoutParams: { returnTo: window.location.origin } });
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>Loading your boards...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.logo}>G4 CollabBoard</h1>
        <div className={styles.headerRight}>
          <span className={styles.userName}>{user?.name || user?.email || 'User'}</span>
          <button className={styles.signOutButton} onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.toolbar}>
          <h2 className={styles.sectionTitle}>Your Boards</h2>
          {slots && (
            <span className={styles.slotInfo}>
              {slots.used} / {slots.total} boards ({slots.tier})
            </span>
          )}
          <button
            className={styles.createButton}
            onClick={handleCreateBoard}
            disabled={creating || (slots !== null && slots.used >= slots.total)}
          >
            {creating ? 'Creating...' : '+ New Board'}
          </button>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        {boards.length === 0 && !error ? (
          <div className={styles.emptyState}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.4">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M12 8v8M8 12h8" />
            </svg>
            <p>No boards yet. Create one to get started!</p>
          </div>
        ) : (
          <div className={styles.boardGrid}>
            {boards.map((board) => (
              <div key={board.id} className={styles.boardCard}>
                <Link
                  to={`/board/${board.id}`}
                  className={styles.boardCardLink}
                >
                  {renamingBoardId === board.id ? (
                    <input
                      ref={renameInputRef}
                      className={styles.boardCardTitleInput}
                      value={renameDraft}
                      placeholder="title?"
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleRenameBoard(board.id, renameDraft);
                        } else if (e.key === 'Escape') {
                          setRenamingBoardId(null);
                        }
                      }}
                      onBlur={() => handleRenameBoard(board.id, renameDraft)}
                      onClick={(e) => e.preventDefault()}
                      maxLength={255}
                    />
                  ) : (
                    <h3 className={styles.boardCardTitle}>{board.title}</h3>
                  )}
                  <p className={styles.boardCardMeta}>
                    {board.objectCount} object{board.objectCount !== 1 ? 's' : ''}
                  </p>
                </Link>
                {renamingBoardId !== board.id && (
                  <div className={styles.boardCardActions}>
                    <button
                      className={styles.boardCardRenameButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenameDraft(board.title);
                        setRenamingBoardId(board.id);
                      }}
                      title="Rename board"
                      aria-label="Rename board"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                      </svg>
                    </button>
                    <button
                      className={styles.boardCardDeleteButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingBoardId(board.id);
                      }}
                      title="Delete board"
                      aria-label="Delete board"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                      </svg>
                    </button>
                  </div>
                )}
                {/* Delete confirmation overlay */}
                {deletingBoardId === board.id && (
                  <div className={styles.deleteConfirm}>
                    <p className={styles.deleteConfirmText}>Delete this board?</p>
                    <div className={styles.deleteConfirmActions}>
                      <button
                        className={styles.deleteConfirmYes}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleDeleteBoard(board.id);
                        }}
                      >
                        Delete
                      </button>
                      <button
                        className={styles.deleteConfirmNo}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setDeletingBoardId(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
