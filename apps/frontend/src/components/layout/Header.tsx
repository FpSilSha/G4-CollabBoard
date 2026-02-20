import { useState, useRef, useEffect, useCallback } from 'react';
import { fabric } from 'fabric';
import { Link } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import { CANVAS_CONFIG } from 'shared';
import { useBoardStore } from '../../stores/boardStore';
import { usePresenceStore, type ConnectionStatus } from '../../stores/presenceStore';
import styles from './Header.module.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Header bar at the top of the main area (right of sidebar).
 *
 * Contains:
 * - Board title (editable via pencil icon)
 * - Zoom controls (-, percentage display, +, home button)
 * - Connection status badge
 * - Presence avatars for remote users in the board
 */
export function Header() {
  const zoom = useBoardStore((s) => s.zoom);
  const canvas = useBoardStore((s) => s.canvas);
  const boardTitle = useBoardStore((s) => s.boardTitle);
  const boardId = useBoardStore((s) => s.boardId);
  const setBoardTitle = useBoardStore((s) => s.setBoardTitle);
  const setZoom = useBoardStore((s) => s.setZoom);
  const connectionStatus = usePresenceStore((s) => s.connectionStatus);
  const remoteUsers = usePresenceStore((s) => s.remoteUsers);
  const { getAccessTokenSilently } = useAuth0();

  const handleZoom = (newZoom: number) => {
    if (!canvas) return;
    const clamped = Math.max(
      CANVAS_CONFIG.MIN_ZOOM,
      Math.min(CANVAS_CONFIG.MAX_ZOOM, newZoom)
    );
    // Zoom toward canvas center
    const center = new fabric.Point(
      canvas.getWidth() / 2,
      canvas.getHeight() / 2
    );
    canvas.zoomToPoint(center, clamped);
    setZoom(clamped);
  };

  const handleZoomIn = () => handleZoom(zoom + CANVAS_CONFIG.ZOOM_STEP);
  const handleZoomOut = () => handleZoom(zoom - CANVAS_CONFIG.ZOOM_STEP);

  /**
   * Home: center the viewport on the defined board center point (0,0)
   * at the current zoom level. The center point is always placed at
   * the center of the viewport, regardless of zoom level.
   */
  const handleHome = () => {
    if (!canvas) return;
    const vpt = canvas.viewportTransform!;
    // Place canvas origin (0,0) at the center of the viewport
    vpt[4] = canvas.getWidth() / 2;
    vpt[5] = canvas.getHeight() / 2;
    canvas.setViewportTransform(vpt);
  };

  const zoomPercent = Math.round(zoom * 100);

  // --- Editable board title ---
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(boardTitle);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the title field when entering edit mode
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const saveBoardTitle = useCallback(async (newTitle: string) => {
    const trimmed = newTitle.trim();
    const finalTitle = trimmed || 'Untitled Board';
    setIsEditingTitle(false);
    setBoardTitle(finalTitle);

    if (!boardId) return;

    try {
      const token = await getAccessTokenSilently({
        authorizationParams: {
          audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
        },
      });
      await fetch(`${API_URL}/boards/${boardId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: finalTitle }),
      });
    } catch (err) {
      console.error('[Header] Failed to rename board:', err);
    }
  }, [boardId, getAccessTokenSilently, setBoardTitle]);

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      saveBoardTitle(titleDraft);
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
      setTitleDraft(boardTitle);
    }
  };

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <Link to="/" className={styles.backLink} title="Back to Dashboard" aria-label="Back to Dashboard">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            className={styles.boardTitleInput}
            value={titleDraft}
            placeholder="title?"
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            onBlur={() => saveBoardTitle(titleDraft)}
            maxLength={255}
          />
        ) : (
          <div className={styles.boardTitleRow}>
            <h1 className={styles.boardTitle}>{boardTitle}</h1>
            <button
              className={styles.editTitleButton}
              onClick={() => {
                setTitleDraft(boardTitle);
                setIsEditingTitle(true);
              }}
              title="Rename board"
              aria-label="Rename board"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className={styles.center}>
        <div className={styles.zoomControls}>
          <button
            className={styles.zoomButton}
            onClick={handleZoomOut}
            title="Zoom Out"
            aria-label="Zoom out"
            disabled={zoom <= CANVAS_CONFIG.MIN_ZOOM}
          >
            &minus;
          </button>
          <span className={styles.zoomLevel}>{zoomPercent}%</span>
          <button
            className={styles.zoomButton}
            onClick={handleZoomIn}
            title="Zoom In"
            aria-label="Zoom in"
            disabled={zoom >= CANVAS_CONFIG.MAX_ZOOM}
          >
            +
          </button>
          <button
            className={styles.homeButton}
            onClick={handleHome}
            title="Return to Center (H)"
            aria-label="Return to center of canvas"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.right}>
        <ConnectionBadge status={connectionStatus} />
        <PresenceAvatars remoteUsers={remoteUsers} />
        <UserMenu />
      </div>
    </header>
  );
}

// ============================================================
// Connection Status Badge
// ============================================================

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  if (status === 'connected') return null;

  const label = status === 'connecting' ? 'Connecting…' : 'Offline';
  const className =
    status === 'connecting'
      ? `${styles.connectionBadge} ${styles.connecting}`
      : `${styles.connectionBadge} ${styles.disconnected}`;

  return <span className={className}>{label}</span>;
}

// ============================================================
// Presence Avatars
// ============================================================

function PresenceAvatars({
  remoteUsers,
}: {
  remoteUsers: Map<string, import('shared').BoardUserInfo>;
}) {
  const users = Array.from(remoteUsers.values());
  if (users.length === 0) return null;

  // Show up to 5 avatars; if more, show a "+N" overflow badge
  const maxVisible = 5;
  const visible = users.slice(0, maxVisible);
  const overflow = users.length - maxVisible;

  return (
    <div className={styles.presenceAvatars}>
      {visible.map((user) => (
        <div
          key={user.userId}
          className={styles.avatar}
          style={{ backgroundColor: user.color }}
          title={user.name}
        >
          {user.avatar && user.avatar.startsWith('http') ? (
            <img
              src={user.avatar}
              alt={user.name}
              className={styles.avatarImg}
            />
          ) : (
            <span className={styles.avatarInitial}>
              {user.avatar || user.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
      ))}
      {overflow > 0 && (
        <div className={styles.avatarOverflow} title={`${overflow} more`}>
          +{overflow}
        </div>
      )}
    </div>
  );
}

// ============================================================
// User Menu (logout)
// ============================================================

function UserMenu() {
  const { user, logout } = useAuth0();
  const localUserName = usePresenceStore((s) => s.localUserName);
  const localUserColor = usePresenceStore((s) => s.localUserColor);

  const displayName = localUserName || user?.name || user?.email || 'User';
  const initial = displayName.charAt(0).toUpperCase();

  const handleLogout = () => {
    logout({ logoutParams: { returnTo: window.location.origin } });
  };

  return (
    <div className={styles.userMenu}>
      <div
        className={styles.userAvatar}
        style={localUserColor ? { backgroundColor: localUserColor } : undefined}
        title={displayName}
      >
        <span className={styles.userAvatarInitial}>{initial}</span>
      </div>
      <button
        className={styles.logoutButton}
        onClick={handleLogout}
        title="Sign out"
        aria-label="Sign out"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
      </button>
    </div>
  );
}
