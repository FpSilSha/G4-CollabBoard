import type { Socket } from 'socket.io-client';

/**
 * Module-level socket reference, accessible from anywhere without prop drilling.
 *
 * Set by useSocket when the socket connects; cleared on disconnect/cleanup.
 * Read by components/hooks that need to emit events but don't receive socketRef as a prop.
 */
let _socket: Socket | null = null;

export function setSocketRef(socket: Socket | null): void {
  _socket = socket;
}

export function getSocketRef(): Socket | null {
  return _socket;
}
