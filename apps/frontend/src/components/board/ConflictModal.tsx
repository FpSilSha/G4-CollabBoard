import type { Socket } from 'socket.io-client';
import { WebSocketEvent } from 'shared';
import { useBoardStore } from '../../stores/boardStore';

interface ConflictModalProps {
  socketRef: React.MutableRefObject<Socket | null>;
}

/**
 * Modal shown when another user modifies an object the local user is editing.
 *
 * Reads `conflictWarning` from boardStore. Two actions:
 * - "Keep my changes" — dismiss the modal, local optimistic state stays.
 * - "Accept their changes" — emit board:request_sync to get full server state,
 *   which triggers a canvas rebuild via the board:sync_response listener.
 */
export function ConflictModal({ socketRef }: ConflictModalProps) {
  const conflictWarning = useBoardStore((s) => s.conflictWarning);
  const setConflictWarning = useBoardStore((s) => s.setConflictWarning);
  const boardId = useBoardStore((s) => s.boardId);

  if (!conflictWarning) return null;

  const handleKeepMyChanges = () => {
    setConflictWarning(null);
  };

  const handleAcceptTheirChanges = () => {
    const socket = socketRef.current;
    if (socket?.connected && boardId) {
      socket.emit(WebSocketEvent.BOARD_REQUEST_SYNC, {
        boardId,
        timestamp: Date.now(),
      });
    }
    setConflictWarning(null);
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h3 style={titleStyle}>Edit Conflict</h3>
        <p style={messageStyle}>{conflictWarning.message}</p>
        <div style={buttonContainerStyle}>
          <button onClick={handleKeepMyChanges} style={keepButtonStyle}>
            Keep my changes
          </button>
          <button onClick={handleAcceptTheirChanges} style={acceptButtonStyle}>
            Accept their changes
          </button>
        </div>
      </div>
    </div>
  );
}

// Inline styles — styling decisions deferred to user preference per plan.
// These provide a functional baseline.
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};

const modalStyle: React.CSSProperties = {
  backgroundColor: '#fff',
  borderRadius: '8px',
  padding: '24px',
  maxWidth: '400px',
  width: '90%',
  boxShadow: '0 4px 24px rgba(0, 0, 0, 0.2)',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: '18px',
  fontWeight: 600,
  color: '#1a1a1a',
};

const messageStyle: React.CSSProperties = {
  margin: '0 0 20px 0',
  fontSize: '14px',
  color: '#666',
  lineHeight: '1.5',
};

const buttonContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  justifyContent: 'flex-end',
};

const keepButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #ddd',
  borderRadius: '6px',
  backgroundColor: '#fff',
  cursor: 'pointer',
  fontSize: '14px',
  color: '#333',
};

const acceptButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: 'none',
  borderRadius: '6px',
  backgroundColor: '#4f46e5',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '14px',
};
