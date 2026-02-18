import { Server } from 'socket.io';
import {
  WebSocketEvent,
  CursorMovePayloadSchema,
  type CursorMovedPayload,
} from 'shared';
import type { AuthenticatedSocket } from '../server';

export function registerCursorHandlers(io: Server, socket: AuthenticatedSocket): void {
  /**
   * cursor:move — Broadcast cursor position to other users.
   * Uses volatile flag: OK to drop packets under load.
   * Per .clauderules: cursor:move throttled 50ms client-side, volatile on server.
   */
  socket.on(WebSocketEvent.CURSOR_MOVE, (payload: unknown) => {
    const parsed = CursorMovePayloadSchema.safeParse(payload);
    if (!parsed.success) return; // Silently drop malformed cursor events

    const { boardId, x, y, timestamp } = parsed.data;
    const currentBoardId = socket.data.currentBoardId;

    // Only broadcast if user is in the specified board room
    if (!currentBoardId || currentBoardId !== boardId) {
      return;
    }

    const movedPayload: CursorMovedPayload = {
      boardId,
      userId: socket.data.userId,
      x,
      y,
      timestamp,
    };

    // volatile: OK to drop cursor packets under load
    socket.volatile.to(boardId).emit(WebSocketEvent.CURSOR_MOVED, movedPayload);
  });
}
