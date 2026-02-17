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
import prisma from './models/index';

const app = express();

// --- Global Middleware ---
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json());

// --- Health Check (no auth) ---
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
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
