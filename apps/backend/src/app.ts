import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import {
  CreateBoardSchema,
  UpdateBoardSchema,
  UpdateProfileSchema,
  BoardIdParamSchema,
  CreateTeleportFlagSchema,
  UpdateTeleportFlagSchema,
  FlagIdParamSchema,
  AICommandRequestSchema,
} from 'shared';
import { requireAuth } from './middleware/auth';
import { validate } from './middleware/validate';
import { errorHandler } from './middleware/errorHandler';
import { apiRateLimit, aiRateLimit } from './middleware/rateLimit';
import { userController } from './controllers/userController';
import { boardController } from './controllers/boardController';
import { versionController } from './controllers/versionController';
import { teleportFlagController } from './controllers/teleportFlagController';
import { aiController } from './controllers/aiController';
import { httpMetrics } from './middleware/httpMetrics';
import { metricsService } from './services/metricsService';
import { editLockService } from './services/editLockService';
import { auditService } from './services/auditService';
import prisma from './models/index';

const app = express();

// --- Global Middleware ---
app.use(helmet());
// Parse FRONTEND_URL: supports comma-separated values (e.g. "http://localhost:5173,http://localhost:5174")
const corsOrigin = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map((u) => u.trim())
  : ['http://localhost:5173', 'http://localhost:5174'];

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Explicit body size limit — prevents oversized payloads
app.use(express.json({ limit: '1mb' }));

// --- HTTP Metrics (before routes so all requests are captured) ---
app.use(httpMetrics);

// --- Health Check (no auth) ---
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
  }
});

// --- Metrics Endpoint ---
// When METRICS_TOKEN is set, requires X-Metrics-Token header.
// When unset (local dev), endpoint stays open.
app.get('/metrics', (req, res, next) => {
  const expectedToken = process.env.METRICS_TOKEN;
  if (expectedToken && req.headers['x-metrics-token'] !== expectedToken) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}, async (req, res) => {
  try {
    const snapshot = await metricsService.getAll();

    // Append active edit locks to the snapshot (multi-user per-user keys)
    const editLocks = await editLockService.getAllLocks();
    const enrichedSnapshot = { ...snapshot, editLocks: { active: editLocks.length, locks: editLocks } };

    // If browser requests HTML, serve an auto-refreshing dashboard
    const acceptsHtml = req.headers.accept?.includes('text/html');
    if (acceptsHtml) {
      const json = JSON.stringify(enrichedSnapshot, null, 2);
      res.type('html').send(`<!DOCTYPE html>
<html><head>
  <title>CollabBoard Metrics</title>
  <meta http-equiv="refresh" content="10">
  <style>body{font-family:monospace;background:#1a1a2e;color:#e0e0e0;padding:20px}
  h1{color:#4f46e5}pre{background:#16213e;padding:16px;border-radius:8px;overflow:auto}
  .ts{color:#888;font-size:12px}</style>
</head><body>
  <h1>CollabBoard Metrics</h1>
  <p class="ts">Auto-refreshes every 10s &mdash; Last updated: ${new Date().toISOString()}</p>
  <pre>${json}</pre>
</body></html>`);
      return;
    }

    res.json(enrichedSnapshot);
  } catch {
    res.status(500).json({ error: 'Failed to retrieve metrics' });
  }
});

// --- Auth Routes ---
app.get('/auth/me', requireAuth, userController.getMe);
app.patch('/auth/me', requireAuth, validate(UpdateProfileSchema), userController.updateMe);

// --- Board Routes ---
app.get('/boards', requireAuth, apiRateLimit, boardController.listBoards);
app.post('/boards', requireAuth, apiRateLimit, validate(CreateBoardSchema), boardController.createBoard);
app.get('/boards/:id', requireAuth, apiRateLimit, validate(BoardIdParamSchema, 'params'), boardController.getBoard);
app.patch('/boards/:id', requireAuth, apiRateLimit, validate(BoardIdParamSchema, 'params'), validate(UpdateBoardSchema), boardController.renameBoard);
app.delete('/boards/:id', requireAuth, apiRateLimit, validate(BoardIdParamSchema, 'params'), boardController.deleteBoard);
app.delete('/boards/:id/link', requireAuth, apiRateLimit, validate(BoardIdParamSchema, 'params'), boardController.unlinkBoard);
app.put('/boards/:id/thumbnail', requireAuth, apiRateLimit, validate(BoardIdParamSchema, 'params'), boardController.saveThumbnail);

// --- Version Routes ---
app.get('/boards/:id/versions', requireAuth, apiRateLimit, validate(BoardIdParamSchema, 'params'), versionController.listVersions);

// --- Teleport Flag Routes ---
app.get('/boards/:id/flags', requireAuth, apiRateLimit, validate(BoardIdParamSchema, 'params'), teleportFlagController.listFlags);
app.post('/boards/:id/flags', requireAuth, apiRateLimit, validate(BoardIdParamSchema, 'params'), validate(CreateTeleportFlagSchema), teleportFlagController.createFlag);
app.patch('/boards/:id/flags/:flagId', requireAuth, apiRateLimit, validate(FlagIdParamSchema, 'params'), validate(UpdateTeleportFlagSchema), teleportFlagController.updateFlag);
app.delete('/boards/:id/flags/:flagId', requireAuth, apiRateLimit, validate(FlagIdParamSchema, 'params'), teleportFlagController.deleteFlag);

// --- AI Routes ---
app.post('/ai/execute', requireAuth, aiRateLimit, validate(AICommandRequestSchema), aiController.executeCommand);
app.get('/ai/status', requireAuth, apiRateLimit, aiController.getStatus);

// --- Audit Routes ---
app.get('/audit/ai-errors', requireAuth, apiRateLimit, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);
    const offset = Math.max(parseInt(req.query.offset as string || '0', 10), 0);
    const result = await auditService.getAIErrors({ limit, offset });
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to fetch AI errors' });
  }
});

// --- Error Handler (must be last) ---
app.use(errorHandler);

export default app;
