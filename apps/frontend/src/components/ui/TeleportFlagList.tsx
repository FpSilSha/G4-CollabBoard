import { useState, useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useFlagStore } from '../../stores/flagStore';
import { useBoardStore } from '../../stores/boardStore';
import { useUIStore } from '../../stores/uiStore';
import { getSocketRef } from '../../stores/socketRef';
import { teleportTo, FLAG_COLORS } from '../../utils/fabricHelpers';
import { WebSocketEvent } from 'shared';
import type { TeleportFlag } from 'shared';
import styles from './TeleportFlagList.module.css';

const AUTH_PARAMS = {
  authorizationParams: {
    audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
  },
};

/**
 * Sidebar list of teleport flags.
 * - Clicking a flag name teleports the viewport to the flag position
 * - Pencil icon opens a modal to edit the label
 * - Trash icon deletes the flag
 * - "Place Flag" button activates placement mode (click canvas to place)
 */
export function TeleportFlagList() {
  const { getAccessTokenSilently } = useAuth0();
  const flags = useFlagStore((s) => s.flags);
  const boardId = useBoardStore((s) => s.boardId);
  const canvas = useBoardStore((s) => s.canvas);
  const updateFlag = useFlagStore((s) => s.updateFlag);
  const deleteFlag = useFlagStore((s) => s.deleteFlag);
  const activeTool = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);

  const [colorPickerId, setColorPickerId] = useState<string | null>(null);

  const getToken = useCallback(
    () => getAccessTokenSilently(AUTH_PARAMS),
    [getAccessTokenSilently],
  );

  const handleTeleport = useCallback(
    (flag: TeleportFlag) => {
      if (!canvas) return;
      teleportTo(canvas, flag.x, flag.y);
    },
    [canvas],
  );

  const handleEditLabel = useCallback(
    async (flag: TeleportFlag) => {
      if (!boardId) return;
      setColorPickerId(null);

      const store = useBoardStore.getState();
      const socket = getSocketRef();

      // Advisory edit lock — lets other users see the warning banner
      store.setEditingObjectId(flag.id);
      if (socket?.connected) {
        socket.emit(WebSocketEvent.EDIT_START, {
          boardId,
          objectId: flag.id,
          timestamp: Date.now(),
        });
      }

      const newLabel = await useUIStore.getState().openTextInputModal({
        title: 'Edit Flag Label',
        initialValue: flag.label,
        placeholder: 'Enter a name for this flag',
      });

      // Release advisory edit lock
      if (socket?.connected) {
        socket.emit(WebSocketEvent.EDIT_END, {
          boardId,
          objectId: flag.id,
          timestamp: Date.now(),
        });
      }
      store.setEditingObjectId(null);
      store.setConcurrentEditors([]);

      if (!newLabel || newLabel === flag.label) return;

      try {
        const token = await getToken();
        await updateFlag(boardId, flag.id, { label: newLabel }, token);
      } catch (err) {
        console.error('[TeleportFlagList] updateFlag error:', err);
      }
    },
    [boardId, updateFlag, getToken],
  );

  const handleDelete = useCallback(
    async (flagId: string) => {
      if (!boardId || !canvas) return;
      try {
        const token = await getToken();
        // Await server confirmation BEFORE removing from canvas
        await deleteFlag(boardId, flagId, token);
        // Server confirmed — now remove canvas marker
        const objects = canvas.getObjects();
        const marker = objects.find((o) => o.data?.flagId === flagId);
        if (marker) {
          canvas.remove(marker);
          canvas.requestRenderAll();
        }
      } catch (err) {
        console.error('[TeleportFlagList] deleteFlag error:', err);
      }
    },
    [boardId, canvas, deleteFlag, getToken],
  );

  const handleColorChange = useCallback(
    async (flagId: string, color: string) => {
      if (!boardId || !canvas) return;
      try {
        const token = await getToken();
        await updateFlag(boardId, flagId, { color }, token);
        // Update canvas marker pennant color
        const objects = canvas.getObjects();
        const marker = objects.find((o) => o.data?.flagId === flagId);
        if (marker && marker.type === 'group') {
          const group = marker as fabric.Group;
          const children = group.getObjects();
          const pennant = children.find((c) => c.type === 'path');
          if (pennant) {
            pennant.set('fill', color);
            canvas.requestRenderAll();
          }
        }
        setColorPickerId(null);
      } catch (err) {
        console.error('[TeleportFlagList] colorChange error:', err);
      }
    },
    [boardId, canvas, updateFlag, getToken],
  );

  const handlePlaceFlag = useCallback(() => {
    setActiveTool('placeFlag');
  }, [setActiveTool]);

  const isPlacing = activeTool === 'placeFlag';

  return (
    <div className={styles.container}>
      {/* Place Flag icon — click to enter placement mode, or drag to canvas */}
      <button
        className={`${styles.placeButton} ${isPlacing ? styles.placing : ''}`}
        onClick={handlePlaceFlag}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/collabboard-type', 'placeFlag');
          e.dataTransfer.effectAllowed = 'copy';
        }}
        title={isPlacing ? 'Click on canvas to place flag' : 'Place a teleport flag (click or drag)'}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="3" y1="1" x2="3" y2="15" />
          <polygon points="4,1 4,8 13,4.5" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {/* Flag list */}
      {flags.length === 0 ? (
        <div className={styles.empty}>No flags placed</div>
      ) : (
        <div className={styles.list}>
          {flags.map((flag) => (
            <div key={flag.id} className={styles.flagItem}>
              {/* Color swatch — click to toggle color picker */}
              <button
                className={styles.colorSwatch}
                style={{ backgroundColor: flag.color }}
                onClick={() =>
                  setColorPickerId(colorPickerId === flag.id ? null : flag.id)
                }
                title="Change flag color"
              />

              {/* Label — click to teleport */}
              <button
                className={styles.flagLabel}
                onClick={() => handleTeleport(flag)}
                title={`Teleport to "${flag.label}"`}
              >
                {flag.label}
              </button>

              {/* Edit icon */}
              <button
                className={styles.iconBtn}
                onClick={() => handleEditLabel(flag)}
                title="Edit label"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z" />
                </svg>
              </button>

              {/* Delete icon */}
              <button
                className={styles.iconBtn}
                onClick={() => handleDelete(flag.id)}
                title="Delete flag"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 3h8M4 3V2h4v1M3 3l.5 7h5L9 3" />
                </svg>
              </button>

              {/* Color picker dropdown */}
              {colorPickerId === flag.id && (
                <div className={styles.colorPicker}>
                  {FLAG_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`${styles.colorOption} ${c === flag.color ? styles.colorSelected : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => handleColorChange(flag.id, c)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
