import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth0 } from '@auth0/auth0-react';
import { WebSocketEvent, WEBSOCKET_CONFIG, type AuthSuccessPayload } from 'shared';
import { usePresenceStore } from '../stores/presenceStore';
import { useBoardStore } from '../stores/boardStore';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3001';
const AUTH_PARAMS = {
  authorizationParams: {
    audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
  },
};

/**
 * Manages the Socket.io client connection lifecycle.
 *
 * - Authenticates with Auth0 JWT via socket.handshake.auth.token
 *   (per .clauderules: NEVER use query params or cookies for JWT)
 * - Refreshes token before each reconnect attempt (prevents stale JWT)
 * - Sends heartbeat every 10s while connected to a board
 * - Updates connectionStatus in presenceStore
 * - On reconnect: re-joins current board to get fresh board:state
 *
 * NOTE: Uses refs to survive React StrictMode double-mount.
 * The socket is only created once and reused across remounts.
 *
 * Returns:
 * - socketRef: ref to the Socket instance (null when not connected)
 * - joinBoard: function to emit board:join
 * - leaveBoard: function to emit board:leave
 */
export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectingRef = useRef(false); // guard against double-connect
  const { getAccessTokenSilently, isAuthenticated, user } = useAuth0();

  // Store getAccessTokenSilently in a ref so the socket's auth callback
  // always has access to the latest version without re-creating the socket.
  const getTokenRef = useRef(getAccessTokenSilently);
  getTokenRef.current = getAccessTokenSilently;

  // Store user profile in a ref so the auth callback can access the latest
  // profile data (name, email) without re-creating the socket.
  const userRef = useRef(user);
  userRef.current = user;

  const setConnectionStatus = usePresenceStore((s) => s.setConnectionStatus);
  const setLocalUser = usePresenceStore((s) => s.setLocalUser);

  // Connect when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

    // Guard: if we already have a live socket, don't create another
    if (socketRef.current?.connected || connectingRef.current) {
      return;
    }

    connectingRef.current = true;

    async function connect() {
      try {
        const token = await getTokenRef.current(AUTH_PARAMS);

        // If a socket was created by a concurrent call (StrictMode), bail
        if (socketRef.current?.connected) {
          connectingRef.current = false;
          return;
        }

        const socket = io(WS_URL, {
          // Auth callback — called on EVERY connection attempt (including reconnects).
          // This ensures the token is always fresh, even if the previous one expired.
          // Also passes the Auth0 user profile (name, email) since access tokens
          // don't include these claims by default.
          auth: async (cb) => {
            try {
              const freshToken = await getTokenRef.current(AUTH_PARAMS);
              cb({
                token: freshToken,
                name: userRef.current?.name,
                email: userRef.current?.email,
              });
            } catch {
              // Fall back to the initial token if refresh fails
              cb({
                token,
                name: userRef.current?.name,
                email: userRef.current?.email,
              });
            }
          },
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
        });

        socketRef.current = socket;
        setConnectionStatus('connecting');

        socket.on('connect', () => {
          setConnectionStatus('connected');
          connectingRef.current = false;

          // Start heartbeat
          startHeartbeat(socket);

          // If we had a board, re-join it (reconnection scenario)
          // Per .clauderules: reconnect = full re-render via board:state
          const boardId = useBoardStore.getState().boardId;
          if (boardId) {
            socket.emit(WebSocketEvent.BOARD_JOIN, { boardId });
          }
        });

        // Server sends user info after successful auth
        socket.on(WebSocketEvent.AUTH_SUCCESS, (payload: AuthSuccessPayload) => {
          setLocalUser(payload.userId, payload.name, payload.color);
        });

        socket.on('disconnect', () => {
          setConnectionStatus('disconnected');
          stopHeartbeat();
        });

        socket.on('connect_error', (err) => {
          setConnectionStatus('disconnected');
          connectingRef.current = false;
          console.error('Socket connection error:', err.message);
        });
      } catch (err) {
        console.error('Failed to get auth token for socket:', err);
        setConnectionStatus('disconnected');
        connectingRef.current = false;
      }
    }

    connect();

    // Cleanup: don't disconnect — let the socket persist across StrictMode
    // remounts. The socket will be cleaned up on logout or page unload.
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  function startHeartbeat(socket: Socket) {
    stopHeartbeat();
    heartbeatRef.current = setInterval(() => {
      const boardId = useBoardStore.getState().boardId;
      if (boardId && socket.connected) {
        socket.emit(WebSocketEvent.HEARTBEAT, {
          boardId,
          timestamp: Date.now(),
        });
      }
    }, WEBSOCKET_CONFIG.HEARTBEAT_INTERVAL);
  }

  function stopHeartbeat() {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }

  const joinBoard = useCallback((boardId: string) => {
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit(WebSocketEvent.BOARD_JOIN, { boardId });
    }
  }, []);

  const leaveBoard = useCallback((boardId: string) => {
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit(WebSocketEvent.BOARD_LEAVE, { boardId });
    }
  }, []);

  return { socketRef, joinBoard, leaveBoard };
}
