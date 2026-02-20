import { Socket } from 'socket.io';
import { metricsService } from '../services/metricsService';

/**
 * Socket.io per-socket middleware that counts inbound events.
 * Registered via socket.use() in server.ts.
 */
export function wsMetricsMiddleware(
  event: [string, ...unknown[]],
  next: (err?: Error) => void
): void {
  const eventName = event[0];
  metricsService.incrementWsEventIn(eventName);
  next();
}

/** Any target that has an .emit() method — Socket, BroadcastOperator, etc. */
interface Emittable {
  emit(event: string, ...args: unknown[]): unknown;
}

/**
 * Emit a WebSocket event to a room/socket and track it in metrics.
 * Drop-in replacement for io.to(room).emit() or socket.emit().
 */
export function trackedEmit(
  target: Emittable,
  event: string,
  data: unknown
): void {
  metricsService.incrementWsEventOut(event);
  target.emit(event, data);
}

/**
 * Volatile emit for cursor events — packets may be dropped under load.
 * Wraps socket.volatile.to(room).emit() with metrics tracking.
 */
export function trackedVolatileEmit(
  socket: Socket,
  room: string,
  event: string,
  data: unknown
): void {
  metricsService.incrementWsEventOut(event);
  socket.volatile.to(room).emit(event, data);
}
