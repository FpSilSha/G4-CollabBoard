import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { CreateBoardSchema, UpdateProfileSchema, BoardIdParamSchema } from 'shared';
import { requireAuth } from './middleware/auth';
import { validate } from './middleware/validate';
import { errorHandler } from './middleware/errorHandler';
import { apiRateLimit } from './middleware/rateLimit';
import { userController } from './controllers/userController';
import { boardController } from './controllers/boardController';
import { versionController } from './controllers/versionController';
import { httpMetrics } from './middleware/httpMetrics';
import { metricsService } from './services/metricsService';
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
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
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

// --- Metrics Endpoint (no auth — standard for metrics scraping) ---
app.get('/metrics', async (_req, res) => {
  try {
    const snapshot = await metricsService.getAll();
    res.json(snapshot);
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
app.delete('/boards/:id', requireAuth, apiRateLimit, validate(BoardIdParamSchema, 'params'), boardController.deleteBoard);

// --- Version Routes ---
app.get('/boards/:id/versions', requireAuth, apiRateLimit, validate(BoardIdParamSchema, 'params'), versionController.listVersions);

// --- Error Handler (must be last) ---
app.use(errorHandler);

export default app;
