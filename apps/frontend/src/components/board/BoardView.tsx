import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import type { Socket } from 'socket.io-client';
import { Sidebar } from '../layout/Sidebar';
import { RightSidebar } from '../layout/RightSidebar';
import { Header } from '../layout/Header';
import { Canvas } from '../canvas/Canvas';
import { StickyEditModal } from '../canvas/StickyEditModal';
import { ColorPickerPanel } from '../canvas/ColorPickerPanel';
import { Toast } from '../ui/Toast';
import { DragEdgeOverlay } from '../ui/DragEdgeOverlay';
import { FloatingTrash } from '../ui/FloatingTrash';
import { TextInputModal } from '../ui/TextInputModal';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useTeleportFlags } from '../../hooks/useTeleportFlags';
import { usePresenceStore } from '../../stores/presenceStore';
import { useBoardStore } from '../../stores/boardStore';
import styles from '../../App.module.css';

interface BoardViewProps {
  socketRef: React.MutableRefObject<Socket | null>;
  joinBoard: (boardId: string) => void;
  leaveBoard: (boardId: string) => void;
}

/**
 * Board canvas view at /board/:boardId.
 *
 * Reads the boardId from the URL, validates it via REST API,
 * and joins the board room via WebSocket.
 *
 * IMPORTANT: socketRef/joinBoard/leaveBoard come from App.tsx
 * so the socket connection survives route changes. This component
 * does NOT own the socket lifecycle — it only joins/leaves boards.
 *
 * +------------------------------------------+
 * |              Header (full width)         |
 * +----------+--------------------+----------+
 * |          |                    |          |
 * | Sidebar  |      Canvas       | RightSB  |
 * |          |                    |          |
 * +----------+--------------------+----------+
 *
 * Offline overlay only shows when authenticated but socket is disconnected
 * (per .clauderules: offline = read-only canvas).
 */
export function BoardView({ socketRef, joinBoard, leaveBoard }: BoardViewProps) {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const { getAccessTokenSilently } = useAuth0();
  const connectionStatus = usePresenceStore((s) => s.connectionStatus);
  const hasEverConnected = usePresenceStore((s) => s.hasEverConnected);
  const storeBoardId = useBoardStore((s) => s.boardId);
  const setBoardId = useBoardStore((s) => s.setBoardId);
  const setBoardTitle = useBoardStore((s) => s.setBoardTitle);
  const setBoardOwnerId = useBoardStore((s) => s.setBoardOwnerId);
  const setMaxObjectsPerBoard = useBoardStore((s) => s.setMaxObjectsPerBoard);
  const clearObjects = useBoardStore((s) => s.clearObjects);

  // Track if this is a real mount (not StrictMode's second mount)
  const mountedRef = useRef(false);

  // Register global keyboard shortcuts (V, S, R, C, I, Delete, Backspace)
  useKeyboardShortcuts(socketRef);

  // Teleport flags: load from API, render on canvas, handle placement + drag
  useTeleportFlags();

  // Validate board exists via REST API, set title, set boardId in store.
  // Uses cancelled flag for StrictMode safety (no ref guards that deadlock).
  useEffect(() => {
    if (!boardId) {
      navigate('/', { replace: true });
      return;
    }

    mountedRef.current = true;
    let cancelled = false;

    async function validateAndSetBoard() {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const token = await getAccessTokenSilently({
          authorizationParams: {
            audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
          },
        });

        const res = await fetch(`${apiUrl}/boards/${boardId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          // Board not found or deleted — redirect to dashboard
          if (!cancelled) navigate('/', { replace: true });
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          setBoardId(data.id);
          setBoardTitle(data.title || 'Untitled Board');
          setBoardOwnerId(data.ownerId ?? null);
          if (data.maxObjectsPerBoard != null) {
            setMaxObjectsPerBoard(data.maxObjectsPerBoard);
          }
          if (data.version != null) {
            useBoardStore.getState().setBoardVersion(data.version);
          }
        }
      } catch (err) {
        console.error('Failed to validate board:', err);
        if (!cancelled) navigate('/', { replace: true });
      }
    }

    // Clear previous board state when navigating to a new board
    clearObjects();
    validateAndSetBoard();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  // Join board via WebSocket when connected and boardId is set in store
  useEffect(() => {
    if (connectionStatus === 'connected' && storeBoardId && storeBoardId === boardId) {
      joinBoard(storeBoardId);
    }
  }, [connectionStatus, storeBoardId, boardId, joinBoard]);

  // Pre-fetch an auth token while the component is still mounted so the
  // unmount cleanup (thumbnail upload) can use it without relying on the
  // Auth0 React hook after the component tree has been torn down.
  const cachedTokenRef = useRef<string | null>(null);
  useEffect(() => {
    getAccessTokenSilently({
      authorizationParams: {
        audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
      },
    }).then((token) => {
      cachedTokenRef.current = token;
    }).catch(() => { /* non-critical */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup: leave board when truly unmounting (navigating away to dashboard
  // or another board). Deferred with setTimeout(0) so StrictMode's simulated
  // unmount→remount cycle can cancel it — prevents spurious board:leave.
  // Also captures a "fit all objects" thumbnail snapshot for the dashboard card.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      const currentBoardId = useBoardStore.getState().boardId;
      const canvas = useBoardStore.getState().canvas;
      const boardVersion = useBoardStore.getState().boardVersion;

      // Capture thumbnail before leaving (fire-and-forget).
      // Computes the bounding box of all objects in *logical* (world) coordinates,
      // sets the viewport to frame them with padding, captures, then restores.
      if (currentBoardId && canvas) {
        try {
          const objects = canvas.getObjects();
          if (objects.length > 0) {
            // Save current viewport state
            const savedVpt = canvas.viewportTransform
              ? [...canvas.viewportTransform]
              : [1, 0, 0, 1, 0, 0];
            const savedZoom = canvas.getZoom();

            // Reset viewport to identity so getBoundingRect returns logical
            // (world) coordinates rather than screen-pixel coordinates.
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

            // Calculate bounding box of all objects in world coordinates
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const obj of objects) {
              const rect = obj.getBoundingRect(true, true);
              minX = Math.min(minX, rect.left);
              minY = Math.min(minY, rect.top);
              maxX = Math.max(maxX, rect.left + rect.width);
              maxY = Math.max(maxY, rect.top + rect.height);
            }

            const contentWidth = maxX - minX;
            const contentHeight = maxY - minY;

            if (contentWidth > 0 && contentHeight > 0) {
              const canvasW = canvas.getWidth();
              const canvasH = canvas.getHeight();

              // Fit zoom with 5% padding
              const padding = 0.05;
              const fitZoom = Math.min(
                canvasW / (contentWidth * (1 + padding * 2)),
                canvasH / (contentHeight * (1 + padding * 2)),
              );

              // Center the content
              const centerX = (minX + maxX) / 2;
              const centerY = (minY + maxY) / 2;
              const offsetX = canvasW / 2 - centerX * fitZoom;
              const offsetY = canvasH / 2 - centerY * fitZoom;

              // Apply fitted viewport and render
              canvas.setViewportTransform([fitZoom, 0, 0, fitZoom, offsetX, offsetY]);
              canvas.renderAll();

              // Capture at ~300px wide
              const multiplier = 300 / Math.max(canvasW, 1);
              const thumbnail = canvas.toDataURL({
                format: 'jpeg',
                quality: 0.5,
                multiplier,
              });

              // Restore original viewport immediately
              canvas.setViewportTransform(savedVpt as unknown as number[]);
              canvas.setZoom(savedZoom);
              canvas.renderAll();

              // Fire-and-forget upload using the pre-cached token
              const token = cachedTokenRef.current;
              if (token) {
                const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
                fetch(`${apiUrl}/boards/${currentBoardId}/thumbnail`, {
                  method: 'PUT',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ thumbnail, version: boardVersion }),
                }).catch((err) => {
                  console.warn('[BoardView] Thumbnail upload failed:', err);
                });
              } else {
                console.warn('[BoardView] No cached token — skipping thumbnail upload');
              }
            }
          }
        } catch (err) {
          console.warn('[BoardView] Thumbnail capture failed:', err);
        }
      }

      if (currentBoardId) {
        // Defer so StrictMode re-mount can cancel by setting mountedRef = true
        setTimeout(() => {
          if (!mountedRef.current) {
            leaveBoard(currentBoardId);
            useBoardStore.getState().setBoardId(null);
            useBoardStore.getState().clearObjects();
            usePresenceStore.getState().clearRemoteUsers();
            usePresenceStore.getState().clearRemoteCursors();
          }
        }, 0);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  return (
    <div className={styles.appLayout}>
      <Header />
      <div className={styles.mainArea}>
        <Sidebar />
        <Canvas socketRef={socketRef} />
        <RightSidebar />
      </div>

      {/* Floating custom color picker — positioned next to the sidebar */}
      <ColorPickerPanel />

      {/* Sticky note text editing modal — driven by editingObjectId in boardStore */}
      <StickyEditModal />

      {/* Toast notification (e.g., object limit warnings) */}
      <Toast />

      {/* Translucent edge glow while dragging objects */}
      <DragEdgeOverlay />

      {/* Floating trash button at bottom-center during drag */}
      <FloatingTrash />

      {/* Generic text-input modal (flag labels, etc.) */}
      <TextInputModal />

      {/* Offline overlay — blocks interaction when socket loses connection.
          Only show AFTER we've connected at least once (not on initial load). */}
      {connectionStatus === 'disconnected' && hasEverConnected && (
        <div className={styles.offlineOverlay}>
          <div className={styles.offlineContent}>
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a16 16 0 0 1 6.34-3.12M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
            </svg>
            <h2>Connection Lost</h2>
            <p>Attempting to reconnect...</p>
          </div>
        </div>
      )}
    </div>
  );
}
