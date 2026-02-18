import { Request, Response, NextFunction } from 'express';
import { metricsService } from '../services/metricsService';

/**
 * UUID regex for route normalization.
 * Replaces UUIDs in paths with ":id" to prevent high-cardinality metric keys.
 */
const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Normalize a raw URL path into a route template.
 * Falls back to replacing UUIDs with :id when Express route is unavailable (404s).
 */
function normalizeRoute(path: string): string {
  return path.replace(UUID_REGEX, ':id');
}

/**
 * Express middleware that records HTTP request count and latency.
 *
 * Extracts the Express route pattern (e.g. "/boards/:id" not "/boards/abc-123")
 * so metrics group by route template, not by individual resource ID.
 *
 * Must be registered BEFORE route handlers in app.ts so that
 * res.on('finish') fires with the correct status code.
 */
export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;

    // req.route?.path gives the Express pattern like "/:id"
    // req.baseUrl gives the prefix like "/boards"
    // Fall back to normalized path for unmatched routes (404s)
    const route = req.route
      ? `${req.baseUrl}${req.route.path}`
      : normalizeRoute(req.path);

    const method = req.method;
    const status = res.statusCode;

    metricsService.incrementHttpRequest(method, route, status);
    metricsService.recordHttpLatency(method, route, durationMs);
  });

  next();
}
