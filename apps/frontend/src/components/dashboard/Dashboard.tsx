import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import styles from './Dashboard.module.css';

interface BoardSummary {
  id: string;
  title: string;
  slot: number;
  lastAccessedAt: string;
  objectCount: number;
  isDeleted: boolean;
  thumbnail: string | null;
  isOwned: boolean;
  ownerId: string;
  version: number;
  thumbnailVersion: number;
}

interface BoardListResponse {
  ownedBoards: BoardSummary[];
  linkedBoards: BoardSummary[];
}

type DashboardTab = 'owned' | 'linked';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const AUTH_PARAMS = {
  authorizationParams: {
    audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
  },
};

/** Strict UUID v4 pattern */
const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Extract a board GUID from arbitrary user input.
 * Accepts:
 *   - Full URL like https://example.com/board/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *   - Just the UUID itself
 *   - Any string containing a UUID (extracts the first match)
 * Returns null if no valid UUID is found.
 */
function extractBoardId(input: string): string | null {
  // Strip whitespace, control characters, angle brackets, quotes
  const sanitized = input.trim().replace(/[<>"'`\x00-\x1f]/g, '');
  const match = sanitized.match(UUID_REGEX);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Dashboard page at "/".
 *
 * Two tabs:
 * - "Your Boards" — boards the user owns (with new-board card at end)
 * - "Linked Boards" — boards the user visited via another user's link
 *
 * Board cards show thumbnail snapshots when available.
 * No tier/enterprise limits — all users have full access.
 */
export function Dashboard() {
  const { getAccessTokenSilently, logout, user } = useAuth0();
  const navigate = useNavigate();
  const [ownedBoards, setOwnedBoards] = useState<BoardSummary[]>([]);
  const [linkedBoards, setLinkedBoards] = useState<BoardSummary[]>([]);
  const [tab, setTab] = useState<DashboardTab>('owned');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Board rename on dashboard ---
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // --- Board delete / unlink on dashboard ---
  const [deletingBoardId, setDeletingBoardId] = useState<string | null>(null);
  const [unlinkingBoardId, setUnlinkingBoardId] = useState<string | null>(null);

  // --- Link input (Linked Boards tab) ---
  const [linkInput, setLinkInput] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);

  // Fetch boards on mount.
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
          setOwnedBoards(data.ownedBoards.filter((b) => !b.isDeleted));
          setLinkedBoards(data.linkedBoards.filter((b) => !b.isDeleted));
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

      const newBoard: BoardSummary = {
        id: created.id,
        title: created.title ?? 'Untitled Board',
        slot: created.slot ?? 0,
        lastAccessedAt: new Date().toISOString(),
        objectCount: 0,
        isDeleted: false,
        thumbnail: null,
        isOwned: true,
        ownerId: user?.sub ?? '',
        version: 0,
        thumbnailVersion: -1,
      };
      setOwnedBoards((prev) => [...prev, newBoard]);

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
    setOwnedBoards((prev) =>
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
    setOwnedBoards((prev) => prev.filter((b) => b.id !== boardId));
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

  const handleUnlinkBoard = async (boardId: string) => {
    // Optimistic removal from linked list
    setLinkedBoards((prev) => prev.filter((b) => b.id !== boardId));
    setUnlinkingBoardId(null);

    try {
      const token = await getAccessTokenSilently(AUTH_PARAMS);
      const res = await fetch(`${API_URL}/boards/${boardId}/link`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.error('[Dashboard] Failed to unlink board:', res.status);
      }
    } catch (err) {
      console.error('[Dashboard] Failed to unlink board:', err);
    }
  };

  /**
   * Handle the "Add board link" input.
   * Extracts a board GUID from the pasted URL/text, validates it exists
   * via the API, and navigates to it (which auto-creates the linked board).
   */
  const handleAddLink = async () => {
    setLinkError(null);

    const boardId = extractBoardId(linkInput);
    if (!boardId) {
      setLinkError('No valid board ID found. Paste a board URL or UUID.');
      return;
    }

    // Check if already linked or owned
    if (linkedBoards.some((b) => b.id === boardId) || ownedBoards.some((b) => b.id === boardId)) {
      setLinkInput('');
      navigate(`/board/${boardId}`);
      return;
    }

    setLinkLoading(true);
    try {
      const token = await getAccessTokenSilently(AUTH_PARAMS);
      const res = await fetch(`${API_URL}/boards/${boardId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        if (res.status === 404) {
          setLinkError('Board not found. Check the link and try again.');
        } else {
          setLinkError(`Failed to load board (${res.status}).`);
        }
        return;
      }

      // Board exists — navigate to it (auto-links via getBoard)
      setLinkInput('');
      navigate(`/board/${boardId}`);
    } catch (err) {
      console.error('[Dashboard] Failed to add linked board:', err);
      setLinkError('Network error. Try again.');
    } finally {
      setLinkLoading(false);
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

  const activeBoards = tab === 'owned' ? ownedBoards : linkedBoards;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.logo}>G4 CollabBoard</h1>
        <div className={styles.headerRight}>
          <Link to="/admin" className={styles.adminLink}>Admin Metrics</Link>
          <span className={styles.userName}>{user?.name || user?.email || 'User'}</span>
          <button className={styles.signOutButton} onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {/* Tab row */}
        <div className={styles.tabRow}>
          <button
            className={`${styles.tab} ${tab === 'owned' ? styles.tabActive : ''}`}
            onClick={() => setTab('owned')}
          >
            Your Boards
          </button>
          <button
            className={`${styles.tab} ${tab === 'linked' ? styles.tabActive : ''}`}
            onClick={() => setTab('linked')}
          >
            Linked Boards
            {linkedBoards.length > 0 && (
              <span className={styles.tabBadge}>{linkedBoards.length}</span>
            )}
          </button>
        </div>

        {/* Link input — shown on Linked Boards tab */}
        {tab === 'linked' && (
          <div className={styles.linkInputRow}>
            <input
              className={styles.linkInput}
              type="text"
              placeholder="Paste a board link or ID to add it..."
              value={linkInput}
              onChange={(e) => {
                setLinkInput(e.target.value);
                setLinkError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && linkInput.trim()) {
                  e.preventDefault();
                  handleAddLink();
                }
              }}
              maxLength={500}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              className={styles.linkInputButton}
              onClick={handleAddLink}
              disabled={!linkInput.trim() || linkLoading}
            >
              {linkLoading ? 'Loading...' : 'Go'}
            </button>
          </div>
        )}
        {linkError && tab === 'linked' && (
          <p className={styles.linkError}>{linkError}</p>
        )}

        {error && <p className={styles.error}>{error}</p>}

        {activeBoards.length === 0 && tab === 'linked' && !error ? (
          <div className={styles.emptyState}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.4">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
            <p>No linked boards yet. Paste a board link above to get started.</p>
          </div>
        ) : (
          <div className={styles.boardGrid}>
            {activeBoards.map((board) => (
              <div key={board.id} className={styles.boardCard}>
                <Link
                  to={`/board/${board.id}`}
                  className={styles.boardCardLink}
                >
                  {board.thumbnail ? (
                    <img
                      src={board.thumbnail}
                      alt=""
                      className={styles.thumbnail}
                      draggable={false}
                    />
                  ) : (
                    <div className={styles.thumbnailPlaceholder}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.25">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M12 8v8M8 12h8" />
                      </svg>
                    </div>
                  )}
                  <div className={styles.boardCardContent}>
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
                  </div>
                </Link>

                {/* Owned board actions: rename + delete */}
                {tab === 'owned' && renamingBoardId !== board.id && (
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

                {/* Linked board actions: unlink only */}
                {tab === 'linked' && (
                  <div className={styles.boardCardActions}>
                    <button
                      className={styles.unlinkButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        setUnlinkingBoardId(board.id);
                      }}
                      title="Remove from linked boards"
                      aria-label="Remove from linked boards"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}

                {/* Delete confirmation overlay (owned boards) */}
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

                {/* Unlink confirmation overlay (linked boards) */}
                {unlinkingBoardId === board.id && (
                  <div className={styles.deleteConfirm}>
                    <p className={styles.deleteConfirmText}>Remove this link?</p>
                    <div className={styles.deleteConfirmActions}>
                      <button
                        className={styles.deleteConfirmYes}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleUnlinkBoard(board.id);
                        }}
                      >
                        Remove
                      </button>
                      <button
                        className={styles.deleteConfirmNo}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setUnlinkingBoardId(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* New board card — only on "Your Boards" tab */}
            {tab === 'owned' && (
              <button
                className={styles.newBoardCard}
                onClick={handleCreateBoard}
                disabled={creating}
                title="Create a new board"
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className={styles.newBoardLabel}>
                  {creating ? 'Creating...' : 'New Board'}
                </span>
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
