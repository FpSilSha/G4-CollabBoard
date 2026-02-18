import { Server } from 'socket.io';
import { WebSocketEvent, HeartbeatPayloadSchema } from 'shared';
import { presenceService } from '../../services/presenceService';
import { logger } from '../../utils/logger';
import type { AuthenticatedSocket } from '../server';

export function registerPresenceHandlers(io: Server, socket: AuthenticatedSocket): void {
  /**
   * heartbeat — Client sends every 10 seconds to maintain presence.
   * Refreshes the Redis presence TTL (30s) so the user doesn't appear as a ghost.
   */
  socket.on(WebSocketEvent.HEARTBEAT, async (payload: unknown) => {
    const parsed = HeartbeatPayloadSchema.safeParse(payload);
    if (!parsed.success) return; // Silently drop malformed heartbeats

    const { boardId } = parsed.data;
    const userId = socket.data.userId;

    if (socket.data.currentBoardId !== boardId) {
      return;
    }

    try {
      await presenceService.refreshPresence(boardId, userId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Heartbeat error for ${userId} on board ${boardId}: ${message}`);
    }
  });
}
