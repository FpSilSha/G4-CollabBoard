import { Server } from 'socket.io';
import { WebSocketEvent, type HeartbeatPayload } from 'shared';
import { presenceService } from '../../services/presenceService';
import type { AuthenticatedSocket } from '../server';

export function registerPresenceHandlers(io: Server, socket: AuthenticatedSocket): void {
  /**
   * heartbeat — Client sends every 10 seconds to maintain presence.
   * Refreshes the Redis presence TTL (30s) so the user doesn't appear as a ghost.
   */
  socket.on(WebSocketEvent.HEARTBEAT, async (payload: HeartbeatPayload) => {
    const { boardId } = payload;
    const userId = socket.data.userId;

    if (!boardId || socket.data.currentBoardId !== boardId) {
      return;
    }

    await presenceService.refreshPresence(boardId, userId);
  });
}
