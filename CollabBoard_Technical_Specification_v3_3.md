# CollabBoard - Technical Specification Document

**Project:** Real-Time Collaborative Whiteboard with AI Agent  
**Timeline:** 7 days with MVP phase  
**Target:** Austin admission requirement  
**Date:** February 17, 2026  
**Version:** 3.0 (Claude Code Optimized)

---

## Executive Summary

Building production-scale collaborative whiteboard infrastructure from scratch with real-time synchronization, multiplayer presence, and natural language AI agent. Focus on AI-first development methodology using Claude Code and structured workflows.

**Core Challenge:** Implement real-time sync between multiple users without using all-in-one services like LiveBlocks.

**Key Constraint:** MVP phase requires working real-time sync, authentication, deployment, and multiplayer cursors.

**Note:** AI agent implementation is deferred to post-MVP. All other features in this specification should be implemented.

**Architecture:** TypeScript monorepo using npm/pnpm workspaces with shared types, schemas, and constants between backend and frontend to prevent drift and ensure type safety.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure) **← NEW**
3. [Environment Configuration](#environment-configuration) **← NEW**
4. [Technology Stack](#technology-stack)
5. [System Requirements](#system-requirements)
6. [Data Models](#data-models)
7. [Database Schema - Prisma](#database-schema-prisma) **← NEW**
8. [Redis Data Structures](#redis-data-structures) **← NEW**
9. [API Specifications](#api-specifications)
10. [Real-Time Sync Architecture](#real-time-sync-architecture)
11. [Security Architecture](#security-architecture)
12. [Deployment Strategy](#deployment-strategy)
13. [Testing Strategy](#testing-strategy)
14. [Cost Analysis](#cost-analysis)
15. [Build Sequence](#build-sequence) **← NEW**
16. [Development Roadmap](#development-roadmap)
17. [Account Setup Checklist](#account-setup-checklist)

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Layer                          │
│  React + TypeScript + Fabric.js + Socket.io-client          │
│  Deployed on Vercel (Static CDN)                            │
└─────────────────────────────────────────────────────────────┘
                            ↓ ↑
                   WebSocket + HTTPS
                            ↓ ↑
┌─────────────────────────────────────────────────────────────┐
│                      Backend Layer                           │
│  Node.js + TypeScript + Express + Socket.io                 │
│  Deployed on Railway                                        │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ REST API     │  │ WebSocket    │  │ Background   │     │
│  │ (CRUD ops)   │  │ (Real-time)  │  │ Workers      │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
          ↓                    ↓                    ↓
    ┌─────────┐          ┌─────────┐         ┌─────────┐
    │PostgreSQL│          │  Redis  │         │  Auth0  │
    │(Railway) │          │(Upstash)│         │         │
    └─────────┘          └─────────┘         └─────────┘
```

### Design Principles

**Zero Trust Security:**
- Every WebSocket message validates JWT token
- Board access verified on every action
- Never trust client-provided IDs
- Server is authoritative source of truth

**Last-Write-Wins with Conflict Detection:**
- Simple timestamp-based conflict resolution
- Client-side conflict warnings when simultaneous edits detected
- No complex CRDT implementation for MVP
- Optimistic UI updates with server confirmation

**Infinite Canvas Coordinate System:**
- Excel-like coordinate positioning (x, y coordinates)
- No canvas bounds enforcement
- Pan/zoom via viewport transforms
- Object count limits, not canvas area limits

---

## Project Structure

### Monorepo Overview

This project uses a **TypeScript monorepo** with npm/pnpm workspaces to share types, schemas, and constants between backend and frontend.

**Why a monorepo with shared packages?**
- ✅ Single source of truth for data models
- ✅ Backend and frontend guaranteed to use identical types
- ✅ WebSocket events stay in sync (using enums)
- ✅ Zod schemas shared for client/server validation
- ✅ No type drift between apps

### Root Structure

```
collabboard/
├── apps/
│   ├── backend/           # Node.js/Express API (deployed to Railway)
│   └── frontend/          # React/Vite SPA (deployed to Vercel)
├── packages/
│   └── shared/            # Shared types, schemas, constants
├── package.json           # Root workspace config
├── .gitignore
└── README.md
```

### Root `package.json`

```json
{
  "name": "collabboard",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "npm run dev --workspaces --if-present",
    "dev:backend": "npm run dev --workspace=apps/backend",
    "dev:frontend": "npm run dev --workspace=apps/frontend",
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

### Shared Package Structure

```
packages/shared/
├── src/
│   ├── types/
│   │   ├── user.types.ts           # User, Subscription interfaces
│   │   ├── board.types.ts          # Board, BoardObject interfaces
│   │   ├── websocket.types.ts      # WebSocket event enums & payloads
│   │   └── api.types.ts            # REST API request/response types
│   │
│   ├── schemas/
│   │   ├── user.schemas.ts         # Zod schemas for User
│   │   ├── board.schemas.ts        # Zod schemas for BoardObject types
│   │   └── validation.ts           # Shared validation helpers
│   │
│   ├── constants/
│   │   ├── limits.ts               # Tier limits (board slots, object counts)
│   │   ├── colors.ts               # Color palette constants
│   │   └── config.ts               # Shared configuration values
│   │
│   └── index.ts                    # Main export file
│
├── package.json
├── tsconfig.json
└── README.md
```

**`packages/shared/package.json`:**

```json
{
  "name": "shared",
  "version": "1.0.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**`packages/shared/src/index.ts`:**

```typescript
// Types
export * from './types/user.types';
export * from './types/board.types';
export * from './types/websocket.types';
export * from './types/api.types';

// Schemas
export * from './schemas/user.schemas';
export * from './schemas/board.schemas';
export * from './schemas/validation';

// Constants
export * from './constants/limits';
export * from './constants/colors';
export * from './constants/config';
```

**Example `packages/shared/src/types/websocket.types.ts`:**

```typescript
// WebSocket event names as enums (prevents typos)
export enum WebSocketEvent {
  // Connection
  BOARD_JOIN = 'board:join',
  BOARD_LEAVE = 'board:leave',
  BOARD_JOINED = 'board:joined',
  BOARD_ERROR = 'board:error',
  
  // Presence
  USER_JOINED = 'user:joined',
  USER_LEFT = 'user:left',
  
  // Cursors
  CURSOR_MOVE = 'cursor:move',
  CURSOR_MOVED = 'cursor:moved',
  
  // Objects
  OBJECT_CREATE = 'object:create',
  OBJECT_CREATED = 'object:created',
  OBJECT_UPDATE = 'object:update',
  OBJECT_UPDATED = 'object:updated',
  OBJECT_DELETE = 'object:delete',
  OBJECT_DELETED = 'object:deleted',
  OBJECTS_BATCH_UPDATE = 'objects:batch_update',
  
  // Sync
  SYNC_CONFLICT = 'sync:conflict'
}

// Payload types for each event
export interface BoardJoinPayload {
  boardId: string;
}

export interface CursorMovePayload {
  boardId: string;
  x: number;
  y: number;
}

export interface ObjectCreatePayload {
  boardId: string;
  object: BoardObject;
}

// ... etc for all events
```

**Example `packages/shared/src/constants/limits.ts`:**

```typescript
export const TIER_LIMITS = {
  FREE: {
    BOARD_SLOTS: 3,
    OBJECTS_PER_BOARD: 100,
    VERSION_HISTORY: false,
  },
  TEAM: {
    BOARD_SLOTS: 10,
    OBJECTS_PER_BOARD: 500,
    VERSION_HISTORY: true,
  },
  ENTERPRISE: {
    BOARD_SLOTS: Infinity,
    OBJECTS_PER_BOARD: 1000,
    VERSION_HISTORY: true,
  },
} as const;

export const RATE_LIMITS = {
  API_REQUESTS_PER_MINUTE: 100,
  AI_COMMANDS_PER_MINUTE: 10,
  OBJECT_CREATES_PER_MINUTE: 50,
} as const;

export const WEBSOCKET_CONFIG = {
  PING_TIMEOUT: 30000,
  PING_INTERVAL: 25000,
  PRESENCE_TTL: 30,
  CURSOR_TTL: 5,
} as const;
```

### Backend Directory Structure

**Note:** All paths below are relative to `apps/backend/`

```
apps/backend/
├── src/
│   ├── controllers/           # Request handlers
│   │   ├── boardController.ts
│   │   ├── userController.ts
│   │   ├── subscriptionController.ts
│   │   └── websocketController.ts
│   │
│   ├── middleware/            # Express middleware
│   │   ├── auth.ts                    # Auth0 JWT validation
│   │   ├── rateLimit.ts               # Redis-based rate limiting
│   │   ├── validate.ts                # Zod schema validation
│   │   └── errorHandler.ts
│   │
│   ├── services/              # Business logic layer
│   │   ├── boardService.ts
│   │   ├── objectService.ts
│   │   ├── presenceService.ts         # Redis presence tracking
│   │   ├── syncService.ts             # Conflict detection
│   │   ├── subscriptionService.ts
│   │   └── versionService.ts
│   │
│   ├── models/                # Prisma client
│   │   └── index.ts
│   │
│   ├── utils/                 # Utility functions
│   │   ├── redis.ts
│   │   ├── logger.ts
│   │   └── helpers.ts
│   │
│   ├── workers/               # Background jobs
│   │   ├── autoSave.ts                # Auto-save every 60s (1 min)
│   │   └── versionSnapshot.ts         # Snapshots every 5 min (every 5th save)
│   │
│   ├── websocket/             # WebSocket server
│   │   ├── server.ts
│   │   ├── handlers/
│   │   │   ├── connectionHandler.ts
│   │   │   ├── cursorHandler.ts
│   │   │   ├── objectHandler.ts
│   │   │   └── presenceHandler.ts
│   │   └── rooms.ts
│   │
│   └── server.ts              # Entry point
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── .env
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

**`apps/backend/package.json`:**

```json
{
  "name": "backend",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "migrate": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "prisma:generate": "prisma generate"
  },
  "dependencies": {
    "shared": "*",
    "express": "^4.18.2",
    "socket.io": "^4.6.0",
    "prisma": "^5.8.0",
    "@prisma/client": "^5.8.0",
    "ioredis": "^5.3.0",
    "jsonwebtoken": "^9.0.2",
    "jwks-rsa": "^3.1.0",
    "zod": "^3.22.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "typescript": "^5.3.0",
    "tsx": "^4.7.0"
  }
}
```

**Usage in backend:**

```typescript
// apps/backend/src/controllers/boardController.ts
import { Board, BoardObject, TIER_LIMITS } from 'shared';
import { BoardObjectSchema } from 'shared';

// Type-safe with shared types
const createBoard = async (req: Request, res: Response) => {
  const userId = req.user.id;
  const userTier = req.user.subscriptionTier;
  
  // Use shared constants
  const maxSlots = TIER_LIMITS[userTier].BOARD_SLOTS;
  
  // Validate with shared schema
  const validatedObject = BoardObjectSchema.parse(req.body);
};
```

```typescript
// apps/backend/src/websocket/handlers/objectHandler.ts
import { WebSocketEvent, ObjectCreatePayload } from 'shared';

socket.on(WebSocketEvent.OBJECT_CREATE, (payload: ObjectCreatePayload) => {
  // Type-safe event handling
});
```

### Frontend Directory Structure

**Note:** All paths below are relative to `apps/frontend/`

```
apps/frontend/
├── src/
│   ├── components/            # React components
│   │   ├── auth/
│   │   │   ├── LoginButton.tsx
│   │   │   ├── LogoutButton.tsx
│   │   │   └── AuthCallback.tsx
│   │   │
│   │   ├── canvas/
│   │   │   ├── Canvas.tsx
│   │   │   ├── Toolbar.tsx
│   │   │   ├── ContextMenu.tsx
│   │   │   └── ZoomControls.tsx
│   │   │
│   │   ├── objects/
│   │   │   ├── StickyNote.tsx
│   │   │   ├── Shape.tsx
│   │   │   ├── Connector.tsx
│   │   │   ├── Frame.tsx
│   │   │   └── TextElement.tsx
│   │   │
│   │   ├── collaboration/
│   │   │   ├── Cursors.tsx
│   │   │   ├── PresenceIndicator.tsx
│   │   │   ├── ConflictModal.tsx
│   │   │   └── ConnectionStatus.tsx
│   │   │
│   │   ├── subscription/
│   │   │   ├── UpgradeModal.tsx
│   │   │   ├── PricingTable.tsx
│   │   │   └── UsageMeter.tsx
│   │   │
│   │   └── layout/
│   │       ├── Header.tsx
│   │       ├── Sidebar.tsx
│   │       └── BoardList.tsx
│   │
│   ├── hooks/                 # Custom React hooks
│   │   ├── useAuth.ts
│   │   ├── useWebSocket.ts
│   │   ├── useCanvas.ts
│   │   ├── usePresence.ts
│   │   ├── useCursors.ts
│   │   └── useBoard.ts
│   │
│   ├── stores/                # Zustand state stores
│   │   ├── boardStore.ts
│   │   ├── userStore.ts
│   │   ├── presenceStore.ts
│   │   └── uiStore.ts
│   │
│   ├── utils/                 # Utility functions
│   │   ├── fabricHelpers.ts
│   │   ├── canvasSync.ts
│   │   └── coordinates.ts
│   │
│   ├── services/              # API clients
│   │   ├── api.ts
│   │   └── websocket.ts
│   │
│   ├── App.tsx
│   ├── main.tsx
│   └── vite-env.d.ts
│
├── public/
├── .env
├── .env.example
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

**`apps/frontend/package.json`:**

```json
{
  "name": "frontend",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx"
  },
  "dependencies": {
    "shared": "*",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "fabric": "^5.3.0",
    "socket.io-client": "^4.6.0",
    "zustand": "^4.4.7",
    "@auth0/auth0-react": "^2.2.4",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.43",
    "@types/react-dom": "^18.2.17",
    "@vitejs/plugin-react": "^4.2.1",
    "typescript": "^5.3.0",
    "vite": "^5.0.8"
  }
}
```

**Usage in frontend:**

```typescript
// apps/frontend/src/hooks/useWebSocket.ts
import { WebSocketEvent, ObjectCreatePayload, BoardObject } from 'shared';

const useWebSocket = () => {
  const socket = io(WS_URL);
  
  // Type-safe event emission
  const createObject = (boardId: string, object: BoardObject) => {
    const payload: ObjectCreatePayload = { boardId, object };
    socket.emit(WebSocketEvent.OBJECT_CREATE, payload);
  };
  
  // Type-safe event listening
  useEffect(() => {
    socket.on(WebSocketEvent.OBJECT_CREATED, (payload) => {
      // payload is correctly typed
    });
  }, []);
};
```

```typescript
// apps/frontend/src/components/subscription/UsageMeter.tsx
import { TIER_LIMITS } from 'shared';

const UsageMeter = () => {
  const { tier, boardCount, objectCount } = useUserStore();
  
  // Use shared constants
  const maxBoards = TIER_LIMITS[tier].BOARD_SLOTS;
  const maxObjects = TIER_LIMITS[tier].OBJECTS_PER_BOARD;
  
  return (
    <div>
      Boards: {boardCount} / {maxBoards}
      Objects: {objectCount} / {maxObjects}
    </div>
  );
};
```

### Deployment Configuration

#### Railway (Backend)

**Settings:**
- Root Directory: `apps/backend`
- Build Command: `npm install && npm run build --workspace=backend`
- Start Command: `npm run start --workspace=backend`
- Install Command: `npm install` (runs at monorepo root)

**Environment Variables:**
Same as documented in Environment Configuration section.

#### Vercel (Frontend)

**Settings:**
- Root Directory: `apps/frontend`
- Build Command: `npm install && npm run build --workspace=frontend`
- Output Directory: `apps/frontend/dist`
- Install Command: `npm install` (runs at monorepo root)

**Environment Variables:**
Same as documented in Environment Configuration section.

### Development Workflow

**Start both apps:**
```bash
npm run dev
```

**Start individually:**
```bash
npm run dev:backend    # Backend only
npm run dev:frontend   # Frontend only
```

**Run tests:**
```bash
npm test               # All workspaces
npm test --workspace=backend
```

**Add dependency to specific app:**
```bash
npm install express --workspace=backend
npm install react --workspace=frontend
npm install date-fns --workspace=shared
```

### Type Safety Benefits

**Before (separate projects):**
```typescript
// backend/src/types/board.types.ts
interface BoardObject { id: string; type: 'sticky_note'; ... }

// frontend/src/types/board.types.ts  
interface BoardObject { id: string; type: 'sticky-note'; ... }  // ❌ Typo!
```

**After (shared package):**
```typescript
// packages/shared/src/types/board.types.ts
export interface BoardObject { id: string; type: 'sticky_note'; ... }

// Both apps import from 'shared' - guaranteed identical! ✅
```

---

## Environment Configuration

### Backend Environment Variables

**File: `collabboard-backend/.env`**

```bash
# Database (Railway PostgreSQL)
DATABASE_URL="postgresql://user:password@host:port/dbname"

# Redis (Upstash)
REDIS_URL="rediss://default:password@host:port"

# Auth0
AUTH0_DOMAIN="your-tenant.us.auth0.com"
AUTH0_AUDIENCE="https://collabboard-api"
AUTH0_ISSUER_BASE_URL="https://your-tenant.us.auth0.com"

# Stripe
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_TEAM_PRICE_ID="price_..."        # Small Team plan price ID
STRIPE_ENTERPRISE_PRICE_ID="price_..."  # Enterprise plan price ID

# Anthropic (for AI agent - post-MVP)
ANTHROPIC_API_KEY="sk-ant-..."

# Server Config
PORT=3001
NODE_ENV="development"  # or "production"
FRONTEND_URL="http://localhost:5173"  # For CORS

# WebSocket Config
WS_PING_TIMEOUT=30000
WS_PING_INTERVAL=25000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000          # 1 minute
RATE_LIMIT_MAX_REQUESTS=100         # 100 requests per minute
RATE_LIMIT_AI_MAX_REQUESTS=10       # 10 AI commands per minute

# Logging
LOG_LEVEL="info"  # debug, info, warn, error
```

**File: `collabboard-backend/.env.example`**
```bash
DATABASE_URL=
REDIS_URL=
AUTH0_DOMAIN=
AUTH0_AUDIENCE=
AUTH0_ISSUER_BASE_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_TEAM_PRICE_ID=
STRIPE_ENTERPRISE_PRICE_ID=
ANTHROPIC_API_KEY=
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
WS_PING_TIMEOUT=30000
WS_PING_INTERVAL=25000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_AI_MAX_REQUESTS=10
LOG_LEVEL=info
```

### Frontend Environment Variables

**File: `collabboard-frontend/.env`**

```bash
# Auth0
VITE_AUTH0_DOMAIN="your-tenant.us.auth0.com"
VITE_AUTH0_CLIENT_ID="your_client_id"
VITE_AUTH0_AUDIENCE="https://collabboard-api"

# Backend API
VITE_API_URL="http://localhost:3001"
VITE_WS_URL="http://localhost:3001"

# Stripe (Publishable Key)
VITE_STRIPE_PUBLISHABLE_KEY="pk_test_..."

# Feature Flags
VITE_ENABLE_AI_AGENT="false"  # Set to "true" post-MVP
VITE_ENABLE_VERSION_HISTORY="true"
```

**File: `collabboard-frontend/.env.example`**
```bash
VITE_AUTH0_DOMAIN=
VITE_AUTH0_CLIENT_ID=
VITE_AUTH0_AUDIENCE=https://collabboard-api
VITE_API_URL=http://localhost:3001
VITE_WS_URL=http://localhost:3001
VITE_STRIPE_PUBLISHABLE_KEY=
VITE_ENABLE_AI_AGENT=false
VITE_ENABLE_VERSION_HISTORY=true
```

---

## Technology Stack

### Frontend Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Framework | React 18+ with TypeScript | Type safety, excellent AI code generation, large ecosystem |
| Build Tool | Vite | Fast builds, HMR, good DX with Claude Code |
| Canvas | Fabric.js | Rich feature set, fallback to Konva.js if timeline pressure |
| State Management | Zustand | Minimal boilerplate, works well with WebSocket updates |
| WebSocket Client | Socket.io-client | Matches backend, auto-reconnection, room support |
| Deployment | Vercel | Free tier, auto-deploy from GitHub, CDN distribution |

**Alternative Considered:** Konva.js (lighter, simpler) - use if Fabric.js learning curve impacts MVP timeline.

### Backend Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Runtime | Node.js 20+ with TypeScript | Type safety, async I/O for WebSockets, good ecosystem |
| Framework | Express | Simple REST API, mature, works with Socket.io |
| WebSocket | Socket.io | Room-based connections, auto-reconnection, fallback support |
| Database | PostgreSQL (Railway) | Relational for audit logs, JSONB for board state, GDPR tooling |
| Cache | Redis (Upstash) | WebSocket session mgmt, presence tracking, rate limiting |
| Deployment | Railway | WebSocket support, PostgreSQL on same platform, cost-effective |

**Migration Path:** Railway → AWS ECS + RDS when hitting 5k+ concurrent users.

### Infrastructure & Services

| Service | Provider | Tier | Cost |
|---------|----------|------|------|
| Authentication | Auth0 | Free (7,500 users/month) | $0 |
| Payments | Stripe | Test mode | $0 (transaction fees only) |
| AI Agent | Anthropic Claude | Pay-per-use | ~$30 for 7-day testing |
| Analytics | PostHog | Self-hosted option | TBD post-MVP |
| Hosting (Backend) | Railway | Starter | ~$12/month |
| Hosting (Frontend) | Vercel | Free | $0 |
| Redis | Upstash | Free (10k cmd/day) | $0 |

**Total 7-Day Budget:** ~$45-50

### Libraries & Building Blocks (Allowed)

**Allowed (building blocks):**
- Socket.io - WebSocket wrapper
- Immer - Immutable state management
- Zod - Runtime validation
- date-fns - Date utilities

**Explicitly Banned:**
- LiveBlocks (all-in-one sync service)

**Status Unknown (confirm before use):**
- Yjs/Automerge (CRDT libraries)
- PartyKit (someone using it, may be allowed)
- Ably, Pusher, Croquet

---

## System Requirements

### Performance Targets

| Metric | Target | Critical for MVP |
|--------|--------|------------------|
| Cursor sync latency | <50ms | Yes |
| Object sync latency | <100ms | Yes |
| Frame rate | 60 FPS (pan/zoom/manipulation) | Yes |
| Object capacity | 500+ objects without degradation | No |
| Concurrent users | 5+ without degradation | Yes |
| Concurrent users per board | 10 max (hard limit) | Yes |

### Scale Targets

| Milestone | Total Users | Concurrent Users | Infrastructure |
|-----------|-------------|------------------|----------------|
| Launch | 100 | ~10 | Railway + Upstash Free |
| 6 months | 10,000 | ~500-1,000 | Railway Pro or AWS migration |
| Final project | 100,000 | ~5,000-10,000 | AWS ECS + RDS + ElastiCache |

**Testing Focus:** 1k concurrent users maximum for final testing.

### Browser Support

- Chrome/Edge (primary development target)
- Firefox (test compatibility)
- Safari (test compatibility)
- Mobile browsers (out of scope for MVP)

### Compliance Requirements

**GDPR (EU users):**
- Data residency (US-only at launch, defer multi-region)
- Right to deletion (soft delete, 30-day retention)
- Data portability (board export feature - post-MVP)
- Audit logs (required)

**PCI DSS:**
- Handled by Stripe (no direct card storage)

**SOC 2:**
- Infrastructure preparation (encryption, access logs)
- No active certification during MVP
- Don't block future certification with architectural decisions

---

## Data Models

### User Model

```typescript
interface User {
  id: string                    // UUID
  email: string                 // From Auth0
  name: string                  // Display name
  avatar: string                // 3-letter initials (generated)
  color: string                 // Hex color for cursor/selections
  subscriptionTier: 'free' | 'team' | 'enterprise'
  subscriptionStatus: 'active' | 'past_due' | 'canceled'
  createdAt: Date
  updatedAt: Date
}
```

**PostgreSQL Table:** `users`

### Board Model

```typescript
interface Board {
  id: string                    // UUID
  ownerId: string               // User ID
  title: string
  objects: BoardObject[]        // JSONB column
  createdAt: Date
  updatedAt: Date
  lastAccessedAt: Date
  isDeleted: boolean            // Soft delete flag
  deletedAt: Date | null
  slot: number                  // Board slot (0-indexed)
}
```

**PostgreSQL Table:** `boards`

**Object Count Limits by Tier:**
- Free: TBD during testing (start with 100 objects)
- Team: TBD (start with 500 objects)
- Enterprise: TBD (start with 1000 objects)

### Board Object Model

```typescript
type BoardObject = StickyNote | Shape | Frame | Connector | TextElement

interface BaseObject {
  id: string                    // UUID
  type: 'sticky' | 'shape' | 'frame' | 'connector' | 'text'
  x: number                     // Coordinate
  y: number                     // Coordinate
  createdBy: string             // User ID
  createdAt: Date
  updatedAt: Date
  lastEditedBy: string          // User ID
}

interface StickyNote extends BaseObject {
  type: 'sticky'
  text: string
  color: string                 // Hex color
  width: number
  height: number
}

interface Shape extends BaseObject {
  type: 'shape'
  shapeType: 'rectangle' | 'circle' | 'line'
  width: number
  height: number
  color: string                 // Solid fill color
  rotation: number              // Degrees
}

interface Frame extends BaseObject {
  type: 'frame'
  title: string
  width: number
  height: number
  color: string                 // Border color
}

interface Connector extends BaseObject {
  type: 'connector'
  fromObjectId: string
  toObjectId: string
  style: 'line' | 'arrow'
  color: string
}

interface TextElement extends BaseObject {
  type: 'text'
  text: string
  fontSize: number
  color: string
}
```

**Storage:** Serialized as JSONB in `boards.objects` column.

### Version History Model

```typescript
interface BoardVersion {
  id: string                    // UUID
  boardId: string
  objects: BoardObject[]        // Snapshot of board state
  createdAt: Date
  versionNumber: number         // Sequential
}
```

**PostgreSQL Table:** `board_versions`

**Version Creation Rule:**
- Auto-save every 1 minute (60 seconds) - saves board state to database
- Version snapshots: Every 5th auto-save (every 5 minutes) - paid tiers only
- Max 50 versions per board (FIFO deletion when limit reached)
- View-only access to versions

### Subscription Model

```typescript
interface Subscription {
  id: string                    // UUID
  userId: string
  tier: 'free' | 'team' | 'enterprise'
  stripeCustomerId: string
  stripeSubscriptionId: string
  status: 'active' | 'past_due' | 'canceled'
  currentPeriodEnd: Date
  createdAt: Date
  updatedAt: Date
}
```

**PostgreSQL Table:** `subscriptions`

**Tier Limits:**

| Feature | Free | Team | Enterprise |
|---------|------|------|------------|
| Board Slots | 2 | 10 | Dynamic (starts at 30) |
| AI Commands | 10/10min | 50/10min | Custom |
| Board Inactive Deletion | 30 days | Never | Never |
| Version History | No | Yes (view-only) | Yes (view-only) |
| Max Objects per Board | TBD (100?) | TBD (500?) | TBD (1000?) |

**Enterprise Dynamic Slots:**
- Start with 30 slots
- Add 30 slots when reaching 25+ used slots
- Remove 30 slots when dropping to 24 or fewer used slots
- Backend manages slot allocation dynamically

**Board Slot Mechanics:**
- Slots 0 and 1 are fixed (never slide)
- Slots 2+ can slide to lower positions when boards deleted
- If payment fails: all boards locked except slots 0-1
- Grace period: 3 days view-only, then complete lockout

### Presence Model (Redis only, ephemeral)

```typescript
interface Presence {
  userId: string
  boardId: string
  userName: string
  userColor: string
  avatar: string                // 3-letter initials
  connectedAt: Date
}
```

**Redis Key:** `board:{boardId}:users` (Set of user IDs)

### Cursor Position (Redis + WebSocket, ephemeral)

```typescript
interface CursorPosition {
  userId: string
  boardId: string
  x: number
  y: number
  timestamp: Date
}
```

**Redis:** Not stored (pure WebSocket broadcast)

**WebSocket Event:** `cursor:moved`

---

## Database Schema (Prisma)

**ORM Choice:** Prisma - provides type-safe database access, automatic migrations, and excellent TypeScript integration.

**File: `collabboard-backend/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                 String        @id @default(uuid())
  email              String        @unique
  name               String
  avatar             String        // 3-letter initials
  color              String        // Hex color for cursor
  subscriptionTier   SubscriptionTier @default(FREE)
  subscriptionStatus SubscriptionStatus @default(ACTIVE)
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt
  
  boards             Board[]       @relation("BoardOwner")
  subscriptions      Subscription[]
  boardVersions      BoardVersion[]
  
  @@index([email])
}

enum SubscriptionTier {
  FREE
  TEAM
  ENTERPRISE
}

enum SubscriptionStatus {
  ACTIVE
  PAST_DUE
  CANCELED
  TRIALING
}

model Board {
  id              String    @id @default(uuid())
  ownerId         String
  title           String
  objects         Json      @default("[]")  // Array of BoardObject
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  lastAccessedAt  DateTime  @default(now())
  isDeleted       Boolean   @default(false)
  deletedAt       DateTime?
  slot            Int       @default(0)
  
  owner           User      @relation("BoardOwner", fields: [ownerId], references: [id])
  versions        BoardVersion[]
  
  @@index([ownerId])
  @@index([isDeleted])
  @@index([lastAccessedAt])
}

model Subscription {
  id                    String              @id @default(uuid())
  userId                String
  stripeCustomerId      String              @unique
  stripeSubscriptionId  String              @unique
  tier                  SubscriptionTier
  status                SubscriptionStatus
  currentPeriodStart    DateTime
  currentPeriodEnd      DateTime
  cancelAtPeriodEnd     Boolean             @default(false)
  createdAt             DateTime            @default(now())
  updatedAt             DateTime            @updatedAt
  
  user                  User                @relation(fields: [userId], references: [id])
  
  @@index([userId])
  @@index([stripeCustomerId])
}

model BoardVersion {
  id         String    @id @default(uuid())
  boardId    String
  snapshot   Json      // Array of BoardObject
  createdBy  String
  createdAt  DateTime  @default(now())
  label      String?
  
  board      Board     @relation(fields: [boardId], references: [id])
  creator    User      @relation(fields: [createdBy], references: [id])
  
  @@index([boardId])
  @@index([createdAt])
}

model AuditLog {
  id         String    @id @default(uuid())
  userId     String
  action     String    // e.g., "create_board", "delete_object", "upgrade_subscription"
  entityType String    // e.g., "board", "object", "subscription"
  entityId   String
  metadata   Json?     // Additional context
  ipAddress  String?
  userAgent  String?
  createdAt  DateTime  @default(now())
  
  @@index([userId])
  @@index([entityType, entityId])
  @@index([createdAt])
}
```

### Running Migrations

**Initial setup:**
```bash
cd collabboard-backend
npx prisma migrate dev --name init
npx prisma generate
```

**After schema changes:**
```bash
npx prisma migrate dev --name describe_your_change
```

**In production:**
```bash
npx prisma migrate deploy
```

---

## Redis Data Structures

Redis stores ephemeral, real-time data that doesn't need persistence:
- **Presence tracking** (who's online)
- **Cursor positions**
- **Rate limiting**
- **WebSocket session management**

### Presence Tracking

**Key Pattern:** `presence:{boardId}:{userId}`

**Value:** JSON string
```json
{
  "userId": "user-123",
  "name": "Alice",
  "avatar": "AL",
  "color": "#FF6B6B",
  "status": "online",
  "lastSeen": 1708178400000
}
```

**TTL:** 30 seconds (auto-refresh on cursor movement)

**Usage:**
```typescript
// Set presence
await redis.setex(
  `presence:${boardId}:${userId}`,
  30,  // TTL in seconds
  JSON.stringify(presenceData)
);

// Get all users on board
const keys = await redis.keys(`presence:${boardId}:*`);
const presenceList = await Promise.all(
  keys.map(key => redis.get(key))
);
```

### Cursor Positions

**Key Pattern:** `cursor:{boardId}:{userId}`

**Value:** JSON string
```json
{
  "x": 450,
  "y": 320,
  "name": "Alice",
  "color": "#FF6B6B"
}
```

**TTL:** 5 seconds (very short, updated frequently)

### Rate Limiting

**Key Pattern:** `ratelimit:{userId}:{action}`

**Value:** Integer (request count)

**TTL:** 60 seconds (rolling window)

**Actions:**
- `api` - General API requests (100/min)
- `ai` - AI agent commands (10/min)
- `create_object` - Object creation (50/min)

**Usage:**
```typescript
const key = `ratelimit:${userId}:${action}`;
const current = await redis.incr(key);

if (current === 1) {
  await redis.expire(key, 60);
}

const limit = action === 'ai' ? 10 : 100;
if (current > limit) {
  throw new Error('Rate limit exceeded');
}
```

### WebSocket Session Management

**Key Pattern:** `ws:session:{socketId}`

**Value:** JSON string
```json
{
  "userId": "user-123",
  "boardId": "board-456",
  "connectedAt": 1708178400000
}
```

**TTL:** 24 hours (cleanup stale sessions)

### Redis Connection Setup

**File: `src/utils/redis.ts`**
```typescript
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL!;

export const redis = new Redis(redisUrl, {
  tls: { rejectUnauthorized: false },  // Upstash uses TLS
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  }
});

redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('error', (err) => console.error('❌ Redis error:', err));
```

---

## API Specifications

### REST API Endpoints

**Base URL:** `https://[railway-backend-url].up.railway.app`

**Authentication:** Bearer token (Auth0 JWT) in `Authorization` header for all endpoints except webhooks.

#### Authentication

```
POST /auth/callback
```

Auth0 callback handler. Exchanges code for tokens.

**Request:** Auth0 redirects with code
**Response:** Sets session cookie, redirects to app

```
GET /auth/me
```

Get current authenticated user.

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "Jane Doe",
  "avatar": "JDO",
  "color": "#3498db",
  "subscriptionTier": "team",
  "subscriptionStatus": "active"
}
```

```
PATCH /auth/me
```

Update user profile (name only).

**Request:**
```json
{
  "name": "New Name"
}
```

**Response:** Updated user object

#### Boards

```
GET /boards
```

List user's boards.

**Query Params:**
- `includeDeleted` (boolean, default false)

**Response:**
```json
{
  "boards": [
    {
      "id": "uuid",
      "title": "Sprint Planning",
      "slot": 0,
      "lastAccessedAt": "2026-02-17T10:00:00Z",
      "objectCount": 42,
      "isDeleted": false
    }
  ],
  "slots": {
    "used": 2,
    "total": 10,
    "tier": "team"
  }
}
```

```
POST /boards
```

Create new board.

**Request:**
```json
{
  "title": "New Board"
}
```

**Response:**
```json
{
  "id": "uuid",
  "title": "New Board",
  "slot": 2,
  "objects": [],
  "createdAt": "2026-02-17T10:00:00Z"
}
```

**Error Cases:**
- 403 if user has reached board slot limit

```
GET /boards/:id
```

Get board details and state.

**Response:**
```json
{
  "id": "uuid",
  "title": "Sprint Planning",
  "slot": 0,
  "objects": [
    {
      "id": "obj-uuid",
      "type": "sticky",
      "x": 100,
      "y": 200,
      "text": "User research",
      "color": "#ffeb3b",
      "width": 200,
      "height": 150,
      "createdBy": "user-uuid",
      "createdAt": "2026-02-17T09:00:00Z",
      "updatedAt": "2026-02-17T09:30:00Z",
      "lastEditedBy": "user-uuid"
    }
  ],
  "lastAccessedAt": "2026-02-17T10:00:00Z"
}
```

**Error Cases:**
- 403 if user doesn't have access
- 404 if board not found
- 423 if board is locked (payment failure)

```
DELETE /boards/:id
```

Soft delete board.

**Response:**
```json
{
  "success": true,
  "deletedAt": "2026-02-17T10:00:00Z",
  "permanentDeletionAt": "2026-03-19T10:00:00Z"
}
```

**Note:** Soft delete, permanent deletion after 30 days unless GDPR requires immediate.

```
GET /boards/:id/versions
```

Get version history (paid tiers only).

**Response:**
```json
{
  "versions": [
    {
      "id": "version-uuid",
      "versionNumber": 10,
      "createdAt": "2026-02-17T09:00:00Z",
      "objectCount": 35
    }
  ]
}
```

**Error Cases:**
- 403 if user not on paid tier

```
GET /boards/:id/versions/:versionNumber
```

Get specific version snapshot (view-only).

**Response:** Same format as `GET /boards/:id` but with historical objects.

#### Subscriptions

```
GET /subscriptions/status
```

Get current subscription status.

**Response:**
```json
{
  "tier": "team",
  "status": "active",
  "currentPeriodEnd": "2026-03-17T10:00:00Z",
  "limits": {
    "boardSlots": 10,
    "aiCommands": 50,
    "maxObjectsPerBoard": 500
  }
}
```

```
POST /subscriptions/checkout
```

Create Stripe checkout session.

**Request:**
```json
{
  "tier": "team"
}
```

**Response:**
```json
{
  "checkoutUrl": "https://checkout.stripe.com/..."
}
```

```
POST /webhooks/stripe
```

Stripe webhook handler (no auth, signature verification only).

**Handles:**
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

**Processing:**
- Updates subscription status
- Locks boards on payment failure after grace period
- Sends notification emails (post-MVP)

#### AI Agent (Post-MVP)

```
POST /ai/execute
```

Execute AI command on board.

**Request:**
```json
{
  "boardId": "uuid",
  "command": "Create a SWOT analysis template"
}
```

**Response:**
```json
{
  "success": true,
  "operations": [
    {
      "type": "createFrame",
      "params": {
        "title": "Strengths",
        "x": 0,
        "y": 0,
        "width": 400,
        "height": 300
      }
    }
  ],
  "rateLimitRemaining": 8
}
```

**Error Cases:**
- 429 if rate limit exceeded

---

### WebSocket Events

**Connection URL:** `wss://[railway-backend-url].up.railway.app`

**Authentication:** JWT token passed in connection query params or initial handshake message.

**Room Model:** Each board is a Socket.io room. Users join rooms for boards they access.

#### Client → Server Events

**Event: `join_board`**

Join a board room.

**Payload:**
```json
{
  "boardId": "uuid"
}
```

**Server Response:**
- Emits `board:state` with current board state
- Emits `user:joined` to all users in room
- Adds user to presence tracking

**Event: `leave_board`**

Leave a board room.

**Payload:**
```json
{
  "boardId": "uuid"
}
```

**Server Response:**
- Emits `user:left` to all users in room
- Removes user from presence tracking

**Event: `object:create`**

Create new board object.

**Payload:**
```json
{
  "boardId": "uuid",
  "object": {
    "type": "sticky",
    "x": 100,
    "y": 200,
    "text": "New note",
    "color": "#ffeb3b",
    "width": 200,
    "height": 150
  },
  "timestamp": 1708163400000
}
```

**Server Response:**
- Validates JWT and board access
- Checks object count limit
- Assigns object ID
- Updates Redis board state
- Emits `object:created` to all users in room

**Event: `object:update`**

Update existing board object.

**Payload:**
```json
{
  "boardId": "uuid",
  "objectId": "obj-uuid",
  "updates": {
    "x": 150,
    "y": 250,
    "text": "Updated text"
  },
  "timestamp": 1708163400000
}
```

**Server Response:**
- Validates JWT and board access
- Checks if object exists
- Updates Redis board state
- Emits `object:updated` to all users in room
- Checks if another user is editing (for conflict detection)

**Event: `object:delete`**

Delete board object.

**Payload:**
```json
{
  "boardId": "uuid",
  "objectId": "obj-uuid",
  "timestamp": 1708163400000
}
```

**Server Response:**
- Validates JWT and board access
- Removes from Redis board state
- Emits `object:deleted` to all users in room

**Event: `cursor:move`**

Broadcast cursor position.

**Payload:**
```json
{
  "boardId": "uuid",
  "x": 450,
  "y": 320,
  "timestamp": 1708163400000
}
```

**Server Response:**
- Emits `cursor:moved` to all OTHER users in room (not sender)
- Does not persist to Redis or PostgreSQL

#### Server → Client Events

**Event: `board:state`**

Initial board state on join.

**Payload:**
```json
{
  "boardId": "uuid",
  "objects": [ /* array of BoardObject */ ],
  "users": [
    {
      "userId": "user-uuid",
      "name": "Jane Doe",
      "avatar": "JDO",
      "color": "#3498db"
    }
  ]
}
```

**Event: `object:created`**

New object created by another user.

**Payload:**
```json
{
  "boardId": "uuid",
  "object": { /* BoardObject with assigned ID */ },
  "userId": "user-uuid",
  "timestamp": 1708163400000
}
```

**Event: `object:updated`**

Object updated by another user.

**Payload:**
```json
{
  "boardId": "uuid",
  "objectId": "obj-uuid",
  "updates": { /* partial object updates */ },
  "userId": "user-uuid",
  "timestamp": 1708163400000
}
```

**Event: `object:deleted`**

Object deleted by another user.

**Payload:**
```json
{
  "boardId": "uuid",
  "objectId": "obj-uuid",
  "userId": "user-uuid",
  "timestamp": 1708163400000
}
```

**Event: `cursor:moved`**

Another user's cursor position.

**Payload:**
```json
{
  "boardId": "uuid",
  "userId": "user-uuid",
  "x": 450,
  "y": 320,
  "timestamp": 1708163400000
}
```

**Event: `user:joined`**

User joined the board.

**Payload:**
```json
{
  "boardId": "uuid",
  "user": {
    "userId": "user-uuid",
    "name": "Jane Doe",
    "avatar": "JDO",
    "color": "#3498db"
  },
  "timestamp": 1708163400000
}
```

**Event: `user:left`**

User left the board.

**Payload:**
```json
{
  "boardId": "uuid",
  "userId": "user-uuid",
  "timestamp": 1708163400000
}
```

**Event: `conflict:warning`**

Conflict detected - another user edited object user is editing.

**Payload:**
```json
{
  "boardId": "uuid",
  "objectId": "obj-uuid",
  "conflictingUserId": "user-uuid",
  "conflictingUserName": "Jane Doe",
  "message": "Jane Doe just updated this object",
  "timestamp": 1708163400000
}
```

**Event: `error`**

Server error (validation failure, rate limit, etc.).

**Payload:**
```json
{
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests. Please slow down.",
  "timestamp": 1708163400000
}
```

---

## Real-Time Sync Architecture

### Sync Strategy: Last-Write-Wins with Conflict Detection

**Core Principles:**
1. Server timestamp is authoritative
2. Optimistic UI updates on client
3. Server broadcasts to all clients
4. Client detects conflicts and warns user

### Data Flow

**Object Creation:**

```
1. User clicks "add sticky note" in Client A
2. Client A generates temp ID, renders immediately (optimistic)
3. Client A sends object:create to server via WebSocket
4. Server validates JWT, board access, object count limit
5. Server assigns permanent ID, stores in Redis
6. Server broadcasts object:created to all clients (including A)
7. Client A replaces temp ID with permanent ID
8. Client B receives object:created, renders new object
```

**Object Update:**

```
1. User drags sticky note in Client A
2. Client A updates local position immediately (optimistic)
3. Client A sends object:update to server via WebSocket
4. Server validates, updates Redis with server timestamp
5. Server broadcasts object:updated to all clients
6. Client A receives confirmation (no-op, already updated)
7. Client B receives update, re-renders object at new position
```

**Simultaneous Edit Conflict:**

```
1. User A starts editing sticky note text (focused input)
2. User B starts editing same sticky note (focused input)
3. User A finishes, sends object:update
4. Server broadcasts to all, including B
5. Client B detects: "I have this object open for editing"
6. Client B shows conflict warning: "User A just updated this note"
7. User B chooses: "Keep my changes" or "Accept theirs"
8. If "Keep": Client B sends update (overwrites A's change)
9. If "Accept": Client B replaces local text with A's version
```

### Redis State Management

**Board State Cache:**

```
Key: board:{boardId}:state
Value: JSON string of objects array
TTL: No expiry (manually evicted on inactivity)
```

**Presence Tracking:**

```
Key: board:{boardId}:users
Value: Set of user IDs
TTL: No expiry (removed on disconnect)
```

**Rate Limiting (AI commands):**

```
Key: ratelimit:ai:{userId}:{bucket}
Value: Integer counter
TTL: 10 minutes
Bucket: floor(timestamp / 600000) // 10-minute buckets
```

**Active Edit Tracking (for conflict detection):**

```
Key: edit:{boardId}:{objectId}
Value: {userId, startedAt}
TTL: 5 minutes (auto-expires if user disconnects without cleanup)
```

### PostgreSQL Persistence

**Auto-Save Pattern:**

Every 1 minute (60 seconds) for each active board:

```
1. Background worker runs on schedule (setInterval every 60 seconds)
2. Query Redis for all active boards (has connected users)
3. For each board:
   a. Read current state from Redis
   b. Write to temp PostgreSQL row (board_temp table)
   c. If write succeeds, overwrite main board row
   d. If write fails, retry 3 times then alert
4. Delete temp row after successful overwrite
```

**Why temp row pattern:**
- Prevents data loss if write fails mid-operation
- Prevents corruption from partial writes
- PostgreSQL transaction ensures atomicity

**Version History Pattern:**

Every 5 minutes (every 5th auto-save):

```
1. Check if user subscription tier allows version history
2. If yes, insert into board_versions table
3. Increment version number
4. Store full snapshot of objects array
5. Enforce max 50 versions per board (delete oldest if limit exceeded)
```

**Database Schema:**

```sql
CREATE TABLE boards (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  slot INTEGER NOT NULL,
  objects JSONB NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMP,
  UNIQUE(owner_id, slot)
);

CREATE INDEX idx_boards_owner ON boards(owner_id);
CREATE INDEX idx_boards_updated ON boards(updated_at);
CREATE INDEX idx_boards_deleted ON boards(is_deleted, deleted_at);
CREATE INDEX idx_boards_version ON boards(id, version);

CREATE TABLE board_versions (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  objects JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(board_id, version_number)
);

CREATE INDEX idx_versions_board ON board_versions(board_id, version_number);
```

### Persistence Race Condition Prevention

**Problem:** Background auto-save could overwrite live edits if Redis state becomes stale between read and write.

**Solution: Versioned Write with Optimistic Locking**

**Auto-Save Logic:**
1. Background worker reads Redis board state
2. Worker includes current Postgres version number in read
3. Worker attempts write with WHERE version = expected_version
4. If write affects 0 rows (version mismatch), abort and retry:
   - Re-read current Postgres state
   - Merge Redis changes on top of Postgres state
   - Increment version
   - Retry write
5. On success, increment version number
6. Update Redis with new version number

**Redis State Structure:**
```typescript
interface CachedBoardState {
  objects: BoardObject[]
  postgresVersion: number  // Track last known Postgres version
  lastSyncedAt: number     // Timestamp of last successful sync
}
```

**Race Condition Example with Solution:**
```
T0: Postgres version=5, Redis version=5, state="Hello"
T1: User edits to "World", Redis updates, version still 5
T2: Background worker reads Redis (version=5, state="World")
T3: User edits to "Goodbye", Redis updates, version still 5
T4: Another user triggers manual save, writes "Goodbye", Postgres version=6
T5: Background worker attempts: UPDATE boards SET objects='World', version=6 WHERE id=X AND version=5
T6: Write fails (0 rows affected, version mismatch)
T7: Worker re-reads Postgres (version=6, state="Goodbye")
T8: Worker merges: keeps "Goodbye" (Postgres wins on conflict), version=7
T9: Success
```

**Critical Rule:** Postgres is authoritative. Redis is cache. On version mismatch, Postgres state wins.

### Fabric.js Object Metadata Binding

**Critical Requirement:** Every Fabric.js canvas object MUST have its CollabBoard object ID stored in metadata.

**Implementation Pattern:**

Object Creation:
```typescript
// Server assigns UUID
const objectId = crypto.randomUUID()

// Client creates Fabric object with metadata
const fabricRect = new fabric.Rect({
  left: 100,
  top: 100,
  fill: '#ff0000',
  width: 200,
  height: 150
})

// CRITICAL: Bind CollabBoard ID to Fabric object
fabricRect.set('data', {
  collabId: objectId,
  type: 'sticky',
  ownerId: userId,
  createdAt: Date.now()
})

canvas.add(fabricRect)
```

**WebSocket Event Targeting:**
```typescript
socket.on('object:updated', ({ objectId, updates }) => {
  const fabricObject = canvas.getObjects().find(obj => 
    obj.data?.collabId === objectId
  )
  
  if (!fabricObject) {
    console.error(`Object ${objectId} not found on canvas`)
    return
  }
  
  fabricObject.set(updates)
  canvas.requestRenderAll()
})
```

**Validation Rule:** Before sending any WebSocket event, client MUST verify `fabricObject.data.collabId` exists and is a valid UUID.

### Ghost User Prevention (Heartbeat + Timeout)

**Problem:** Users who disconnect abruptly (network drop, browser crash, lid close) may not trigger Socket.io disconnect event immediately.

**Solution: Dual-Layer Detection**

**Layer 1: Socket.io Disconnect Event (Primary)**
```typescript
socket.on('disconnect', (reason) => {
  removeUserFromPresence(boardId, userId)
  io.to(boardId).emit('user:left', { boardId, userId, timestamp: Date.now() })
  clearActiveEdits(userId)
})
```

**Layer 2: Heartbeat + Timeout (Backup)**

Client heartbeat every 10 seconds:
```typescript
setInterval(() => {
  if (socket.connected) {
    socket.emit('heartbeat', { boardId, timestamp: Date.now() })
  }
}, 10000)
```

Server tracks heartbeats in Redis with 30-second TTL:
```typescript
socket.on('heartbeat', ({ boardId }) => {
  redis.setex(
    `presence:${boardId}:${userId}`,
    30,
    JSON.stringify({
      userId,
      userName: socket.userName,
      avatar: socket.avatar,
      color: socket.color,
      lastHeartbeat: Date.now()
    })
  )
})
```

Background cleanup runs every 15 seconds to detect expired TTLs (ghost users).

**Timeout Values:**
- Client heartbeat: 10 seconds
- Redis presence TTL: 30 seconds
- Server cleanup check: 15 seconds
- Max ghost detection time: 30 seconds

### WebSocket Authentication: Socket.io Auth Object

**CRITICAL: Use Socket.io `auth` object, NOT query params or cookies.**

**Client Connection:**
```typescript
const socket = io(WS_URL, {
  auth: {
    token: getJwtFromAuthProvider()
  },
  transports: ['websocket', 'polling'],
  reconnection: true
})
```

**Server Middleware:**
```typescript
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token
  
  if (!token) {
    return next(new Error('Authentication token required'))
  }
  
  try {
    const decoded = await verifyAuth0Token(token)
    socket.userId = decoded.sub
    socket.userName = decoded.name
    socket.color = generateColorFromUserId(decoded.sub)
    socket.avatar = generateAvatar(decoded.name)
    next()
  } catch (err) {
    next(new Error('Invalid authentication token'))
  }
})
```

**Security Rules:**
1. NEVER send JWT in URL query params
2. NEVER log the JWT value server-side
3. Validate JWT on EVERY connection (including reconnects)
4. Rotate tokens regularly (50-minute refresh for 1-hour expiry)

### Client-Side Event Throttling (Anti-Flooding)

**Problem:** Rapid mouse movement generates hundreds of events per second, overwhelming the WebSocket server.

**Solution: Client-Side Throttle**

**Cursor Movement Throttling:**
```typescript
import { throttle } from 'lodash'

const throttledCursorMove = throttle((x: number, y: number) => {
  socket.emit('cursor:move', {
    boardId: currentBoardId,
    x,
    y,
    timestamp: Date.now()
  })
}, 50, { leading: true, trailing: true })

canvas.on('mouse:move', (event) => {
  const pointer = canvas.getPointer(event.e)
  throttledCursorMove(pointer.x, pointer.y)
})
```

**Object Transform Throttling:**
```typescript
const throttledObjectUpdate = throttle((objectId: string, updates: object) => {
  socket.emit('object:update', {
    boardId: currentBoardId,
    objectId,
    updates,
    timestamp: Date.now()
  })
}, 100, { leading: false, trailing: true })

canvas.on('object:moving', (event) => {
  const obj = event.target
  throttledObjectUpdate(obj.data.collabId, {
    left: obj.left,
    top: obj.top
  })
})

canvas.on('object:modified', (event) => {
  const obj = event.target
  throttledObjectUpdate.cancel()
  socket.emit('object:update', {
    boardId: currentBoardId,
    objectId: obj.data.collabId,
    updates: {
      left: obj.left,
      top: obj.top,
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      angle: obj.angle
    },
    timestamp: Date.now()
  })
})
```

**Throttle Settings:**
| Event | Client Throttle | Rationale |
|-------|----------------|-----------|
| cursor:move | 50ms (20/sec) | Smooth cursor, don't overwhelm |
| object:moving | 100ms (10/sec) | During drag, reduce chatter |
| object:modified | None (immediate) | Final position must be accurate |

**Critical Rule:** Always send final state immediately (unthrottled) when interaction ends.

### Offline State Divergence Prevention

**Problem:** Without CRDTs, offline edits create unresolvable conflicts when reconnecting.

**Solution: Read-Only Lock on Disconnect**

**Disconnect Handling:**
```typescript
socket.on('disconnect', (reason) => {
  connectionState = ConnectionState.DISCONNECTED
  
  showBanner({
    type: 'warning',
    message: 'Connection lost. Attempting to reconnect...'
  })
  
  setCanvasReadOnly(true)
  
  setTimeout(() => {
    if (connectionState === ConnectionState.DISCONNECTED) {
      showBanner({
        type: 'error',
        message: 'You are offline. Board is read-only until reconnected.'
      })
    }
  }, 5000)
})
```

**Read-Only Canvas:**
```typescript
function setCanvasReadOnly(readOnly: boolean) {
  canvas.selection = !readOnly
  
  canvas.getObjects().forEach(obj => {
    obj.selectable = !readOnly
    obj.evented = !readOnly
    obj.lockMovementX = readOnly
    obj.lockMovementY = readOnly
    obj.lockScalingX = readOnly
    obj.lockScalingY = readOnly
    obj.lockRotation = readOnly
  })
  
  document.querySelectorAll('.toolbar-button').forEach(btn => {
    btn.disabled = readOnly
  })
  
  canvas.requestRenderAll()
}
```

**Reconnection with State Reconciliation:**
```typescript
socket.on('connect', async () => {
  showBanner({ type: 'info', message: 'Reconnected. Syncing board state...' })
  
  socket.emit('board:request_sync', { boardId: currentBoardId })
})

socket.on('board:sync_response', ({ objects }) => {
  canvas.clear()
  
  objects.forEach(obj => {
    const fabricObj = createFabricObject(obj)
    canvas.add(fabricObj)
  })
  
  canvas.requestRenderAll()
  setCanvasReadOnly(false)
  hideBanner()
})
```

**UX Guidelines:**
1. Show "Connection Lost" banner immediately
2. Disable all edit actions within 5 seconds
3. Allow navigation and viewing while offline
4. On reconnect, fetch fresh state from server (server wins)
5. Warn user that any offline edits were discarded

**Auto-Save Logic:**
1. Background worker reads Redis board state
2. Worker includes current Postgres version number in read
3. Worker attempts write with WHERE version = expected_version
4. If write affects 0 rows (version mismatch), abort and retry:
   - Re-read current Postgres state
   - Merge Redis changes on top of Postgres state
   - Increment version
   - Retry write
5. On success, increment version number
6. Update Redis with new version number

**Redis State Structure:**
```typescript
interface CachedBoardState {
  objects: BoardObject[]
  postgresVersion: number  // Track last

### WebSocket Connection Management

**Connection Lifecycle:**

```
1. Client connects with JWT in handshake
2. Server validates JWT, extracts userId
3. Server stores connection in memory map: connectionId → userId
4. Client sends join_board event
5. Server joins Socket.io room for boardId
6. Server adds userId to Redis presence set
7. Server broadcasts user:joined to room
8. Server sends board:state to new user
```

**Disconnect Handling:**

```
1. Client disconnects (network failure, tab close, etc.)
2. Server detects disconnect event
3. Server removes from all Socket.io rooms
4. Server removes from Redis presence sets
5. Server broadcasts user:left to all affected rooms
6. Server removes from active edit tracking
```

**Reconnection:**

```
1. Client detects disconnect
2. Client attempts reconnection (Socket.io auto-retry)
3. On reconnect, client re-validates JWT
4. Client re-sends join_board for current board
5. Server sends updated board:state (may have changed)
6. Client reconciles local state with server state
```

### Conflict Detection Algorithm

**Client-Side Tracking:**

```typescript
// Client maintains active edits
const activeEdits = new Map<string, {
  objectId: string,
  startedAt: number,
  localChanges: Partial<BoardObject>
}>()

// When user focuses on editable object
function handleEditStart(objectId: string) {
  activeEdits.set(objectId, {
    objectId,
    startedAt: Date.now(),
    localChanges: {}
  })
}

// When receiving update from server
function handleObjectUpdated(event: ObjectUpdatedEvent) {
  const activeEdit = activeEdits.get(event.objectId)
  
  if (activeEdit && event.userId !== currentUserId) {
    // Conflict detected!
    showConflictWarning({
      objectId: event.objectId,
      conflictingUser: event.userName,
      theirChanges: event.updates,
      myChanges: activeEdit.localChanges
    })
  } else {
    // No conflict, apply update
    updateObjectInCanvas(event.objectId, event.updates)
  }
}

// Conflict resolution UI
function showConflictWarning(conflict: Conflict) {
  const choice = await showModal({
    title: `${conflict.conflictingUser} just updated this object`,
    message: "You have unsaved changes. What would you like to do?",
    options: [
      { label: "Keep my changes", value: "keep" },
      { label: "Accept their changes", value: "accept" }
    ]
  })
  
  if (choice === "keep") {
    // Send local changes (will overwrite theirs)
    socket.emit('object:update', {
      objectId: conflict.objectId,
      updates: conflict.myChanges,
      timestamp: Date.now()
    })
  } else {
    // Discard local changes, accept theirs
    updateObjectInCanvas(conflict.objectId, conflict.theirChanges)
    activeEdits.delete(conflict.objectId)
  }
}
```

**Server-Side Conflict Tracking:**

```typescript
// Server tracks who is editing what
const activeEdits = new Map<string, {
  boardId: string,
  objectId: string,
  userId: string,
  startedAt: number
}>()

// When client starts editing
socket.on('edit:start', ({ boardId, objectId }) => {
  const editKey = `${boardId}:${objectId}`
  activeEdits.set(editKey, {
    boardId,
    objectId,
    userId: socket.userId,
    startedAt: Date.now()
  })
})

// When object update arrives
socket.on('object:update', async ({ boardId, objectId, updates }) => {
  const editKey = `${boardId}:${objectId}`
  const currentEdit = activeEdits.get(editKey)
  
  // Check if someone else is editing
  if (currentEdit && currentEdit.userId !== socket.userId) {
    // Notify the other user of potential conflict
    io.to(currentEdit.userId).emit('conflict:warning', {
      objectId,
      conflictingUserId: socket.userId,
      conflictingUserName: socket.userName
    })
  }
  
  // Process update normally (last-write-wins)
  await updateBoardObject(boardId, objectId, updates)
  io.to(boardId).emit('object:updated', {
    boardId,
    objectId,
    updates,
    userId: socket.userId,
    timestamp: Date.now()
  })
})
```

---

## Security Architecture

### Zero Trust Principles

**Every action is verified:**
1. Extract JWT from request/message
2. Verify signature and expiration
3. Extract userId from token
4. Verify user has access to resource (board, object)
5. Validate input data
6. Check rate limits
7. Execute action
8. Log to audit trail

**No assumptions:**
- Client-provided userId is never trusted
- Object IDs are validated to exist
- Board access is checked on every operation
- Subscription tier is fetched fresh for feature checks

### Authentication Flow

**Initial Login:**

```
1. User clicks "Sign In"
2. Frontend redirects to Auth0 hosted login
3. User authenticates (email/password or social)
4. Auth0 redirects to /auth/callback with code
5. Backend exchanges code for JWT access token
6. Backend sets httpOnly cookie with JWT
7. Backend redirects user to app
8. Frontend reads user info from /auth/me
```

**WebSocket Authentication:**

```
1. Client connects to WebSocket server
2. Client sends 'authenticate' event with JWT from cookie
3. Server validates JWT (signature, expiration)
4. Server extracts userId, stores in connection metadata
5. Server responds with success/failure
6. If failure, server disconnects client
```

**Token Refresh:**

Auth0 handles token refresh automatically. Backend checks expiration on every request and WebSocket message.

### Authorization Model

**Board Access Rules:**

- User can access board if:
  - User is the owner (created the board)
  - User has been granted access (collaboration feature - post-MVP)

**Object Modification Rules:**

- User can modify object if:
  - User has access to the board
  - Object exists on the board

**Feature Access Rules:**

- Version history: Paid tiers only
- AI commands: All tiers (rate limited per tier)
- Board creation: Within slot limits for tier
- Object creation: Within object count limits for tier

### Input Validation

**WebSocket Message Validation:**

```typescript
// Example: object:update validation
const updateSchema = z.object({
  boardId: z.string().uuid(),
  objectId: z.string().uuid(),
  updates: z.object({
    x: z.number().min(-1000000).max(1000000).optional(),
    y: z.number().min(-1000000).max(1000000).optional(),
    text: z.string().max(10000).optional(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    width: z.number().min(50).max(2000).optional(),
    height: z.number().min(50).max(2000).optional(),
    rotation: z.number().min(-360).max(360).optional()
  }),
  timestamp: z.number()
})

socket.on('object:update', async (data) => {
  // Validate input schema
  const result = updateSchema.safeParse(data)
  if (!result.success) {
    socket.emit('error', {
      code: 'INVALID_INPUT',
      message: 'Invalid update data',
      errors: result.error.errors
    })
    return
  }
  
  // Continue with authorization and processing
})
```

**XSS Prevention:**

- Sanitize text input on server before storing
- Frontend uses React (auto-escapes by default)
- No `dangerouslySetInnerHTML` usage
- Content-Security-Policy headers

**SQL Injection Prevention:**

- Use parameterized queries (pg library)
- Never concatenate user input into SQL
- ORM-style query builders where possible

### Rate Limiting

**API Rate Limits:**

```
Endpoint: All REST endpoints
Limit: 100 requests per minute per IP
Implementation: Express middleware + Redis
Response: 429 Too Many Requests
```

**WebSocket Rate Limits:**

```
Event: All WebSocket messages
Limit: 60 messages per second per connection
Implementation: Socket.io middleware + in-memory counter
Response: Disconnect after warning
```

**AI Command Rate Limits:**

```
Endpoint: POST /ai/execute
Limit: 10 commands per 10 minutes (free), 50 (team), custom (enterprise)
Implementation: Redis counter with sliding window
Response: 429 with remaining time until reset
```

**Implementation Pattern:**

```typescript
// Redis-based rate limiter
async function checkRateLimit(
  userId: string,
  action: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean, remaining: number }> {
  const key = `ratelimit:${action}:${userId}:${Math.floor(Date.now() / windowMs)}`
  
  const current = await redis.get(key)
  const count = current ? parseInt(current) : 0
  
  if (count >= limit) {
    return { allowed: false, remaining: 0 }
  }
  
  await redis.multi()
    .incr(key)
    .expire(key, Math.ceil(windowMs / 1000))
    .exec()
  
  return { allowed: true, remaining: limit - count - 1 }
}
```

### CORS Configuration

```typescript
// Backend CORS setup
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? ['https://[vercel-app-url].vercel.app']
    : ['http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}

app.use(cors(corsOptions))
```

### Stripe Webhook Security

```typescript
// Verify Stripe signature on webhook
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature']
  
  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    )
    
    // Process event
    handleStripeEvent(event)
    
    res.json({ received: true })
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    res.status(400).send(`Webhook Error: ${err.message}`)
  }
})
```

### Audit Logging

**What to Log:**

- User authentication events (login, logout, token refresh)
- Board access (view, create, update, delete)
- Object modifications (who changed what, when)
- Subscription changes (tier upgrade/downgrade, payment)
- AI command execution
- Rate limit violations
- Authentication failures
- Authorization failures

**Log Format:**

```typescript
interface AuditLog {
  id: string
  userId: string
  action: string
  resource: string
  resourceId: string
  metadata: object
  ipAddress: string
  userAgent: string
  timestamp: Date
}
```

**PostgreSQL Table:**

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(100) NOT NULL,
  resource_id UUID,
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at);
CREATE INDEX idx_audit_resource ON audit_logs(resource, resource_id);
```

**Retention Policy:**

- Keep all audit logs for 90 days
- Archive logs >90 days to cold storage (post-MVP)
- GDPR deletion requests purge user's audit logs

---

## Deployment Strategy

### Environment Setup

**Environments:**

1. **Development** - Local machine
2. **Staging** - Railway preview environments (optional)
3. **Production** - Railway + Vercel

**Environment Variables:**

Backend (Railway):
```
DATABASE_URL=postgresql://... (auto-provided by Railway)
REDIS_URL=redis://... (from Upstash)
AUTH0_DOMAIN=dev-xyz.us.auth0.com
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_AUDIENCE=https://collabboard-api
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
ANTHROPIC_API_KEY=sk-ant-... (post-MVP)
NODE_ENV=production
FRONTEND_URL=https://collabboard.vercel.app
```

Frontend (Vercel):
```
VITE_API_URL=https://collabboard-backend.up.railway.app
VITE_WS_URL=wss://collabboard-backend.up.railway.app
VITE_AUTH0_DOMAIN=dev-xyz.us.auth0.com
VITE_AUTH0_CLIENT_ID=...
VITE_AUTH0_AUDIENCE=https://collabboard-api
VITE_STRIPE_PUBLIC_KEY=pk_test_...
```

### Deployment Process

**Backend Deployment (Railway):**

**Railway Configuration:**
- **Root Directory:** `apps/backend`
- **Build Command:** `npm install && npm run build --workspace=backend`
- **Start Command:** `npm run start --workspace=backend`
- **Install Command:** `npm install` (runs at monorepo root, installs all workspaces)

**Backend `package.json` scripts:**
```json
{
  "scripts": {
    "build": "prisma generate && prisma migrate deploy && tsc",
    "start": "node dist/server.js",
    "dev": "tsx watch src/server.ts",
    "migrate": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy"
  }
}
```

**Deployment Flow:**
1. Push code to GitHub main branch
2. Railway detects commit via webhook
3. Railway provisions PostgreSQL if not exists
4. Railway sets `DATABASE_URL` environment variable
5. Railway runs `npm install` at monorepo root
   - Installs all workspaces (backend, frontend, shared)
   - Resolves `shared` package locally
6. Railway runs `npm run build --workspace=backend`:
   - `prisma generate` → Creates Prisma Client
   - **`prisma migrate deploy` → Applies pending migrations**
   - `tsc` → Compiles TypeScript
7. Railway runs `npm start --workspace=backend` → Starts server
8. Railway exposes public URL with HTTPS

**CRITICAL: Migration runs BEFORE server starts. If migration fails, deployment fails.**

**Health Check Endpoint:**
```typescript
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'healthy', database: 'connected' })
  } catch (error) {
    res.status(503).json({ status: 'unhealthy' })
  }
})
```

**Preview Deployments:**

When PR is opened, Railway creates ephemeral environment with temporary database for safe migration testing.

**Frontend Deployment (Vercel):**

**Vercel Configuration:**
- **Root Directory:** `apps/frontend`
- **Build Command:** `npm install && npm run build --workspace=frontend`
- **Output Directory:** `apps/frontend/dist`
- **Install Command:** `npm install` (runs at monorepo root)

**Deployment Flow:**
```
1. Push code to GitHub main branch
2. Vercel detects commit via webhook
3. Vercel runs `npm install` at monorepo root
   - Installs all workspaces
   - Resolves `shared` package locally
4. Vercel runs `npm run build --workspace=frontend`:
   - TypeScript compilation with shared types
   - Vite builds production bundle
5. Vercel deploys static files from apps/frontend/dist to CDN
6. Vercel provides public URL with HTTPS
7. Verify site loads and connects to backend
```

### CI/CD Pipeline

**Minimal Pipeline for MVP:**

- Push to main → auto-deploy
- Automated health checks after deployment

**Post-MVP Pipeline:**

- Push to feature branch → Railway preview environment
- Run Playwright tests on preview
- Manual approval before merge to main
- Merge to main → auto-deploy to production
- Automated smoke tests on production
- Rollback capability via Railway dashboard

### Database Migrations

**CRITICAL: Use Prisma for all database interactions. No raw SQL, no manual migrations.**

**Why Prisma:**
- Type-safe schema definition
- Automatic TypeScript type generation
- Git-trackable migration history
- Prevents schema drift between environments
- Built-in migration rollback support

**Schema Definition:**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                String   @id @default(uuid())
  email             String   @unique
  name              String
  avatar            String
  color             String
  subscriptionTier  String   @default("free")
  subscriptionStatus String  @default("active")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  boards            Board[]
  subscriptions     Subscription[]
}

model Board {
  id              String    @id @default(uuid())
  ownerId         String
  owner           User      @relation(fields: [ownerId], references: [id])
  title           String
  slot            Int
  objects         Json      @default("[]")
  version         Int       @default(0)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  lastAccessedAt  DateTime  @default(now())
  isDeleted       Boolean   @default(false)
  deletedAt       DateTime?
  versions        BoardVersion[]
  
  @@unique([ownerId, slot])
  @@index([ownerId])
  @@index([updatedAt])
  @@index([isDeleted, deletedAt])
  @@index([id, version])
}

model BoardVersion {
  id            String   @id @default(uuid())
  boardId       String
  board         Board    @relation(fields: [boardId], references: [id], onDelete: Cascade)
  versionNumber Int
  objects       Json
  createdAt     DateTime @default(now())
  
  @@unique([boardId, versionNumber])
  @@index([boardId, versionNumber])
}

model Subscription {
  id                   String   @id @default(uuid())
  userId               String
  user                 User     @relation(fields: [userId], references: [id])
  tier                 String
  stripeCustomerId     String?
  stripeSubscriptionId String?
  status               String
  currentPeriodEnd     DateTime?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}

model AuditLog {
  id         String   @id @default(uuid())
  userId     String?
  action     String
  resource   String
  resourceId String?
  metadata   Json?
  ipAddress  String?
  userAgent  String?
  createdAt  DateTime @default(now())
  
  @@index([userId, createdAt])
  @@index([resource, resourceId])
}
```

**Migration Workflow:**

Development (Local):
```bash
npx prisma migrate dev --name add_version_column
```

Production (Railway) - automated in build script:
```json
"scripts": {
  "build": "prisma generate && prisma migrate deploy && tsc",
  "start": "node dist/server.js"
}
```

**CRITICAL SAFETY RULES:**

1. NEVER use `prisma migrate reset` in production
2. NEVER use `prisma db push` in production
3. NEVER use `--force` flag on migrations
4. ALWAYS commit migration files to Git
5. NEVER edit generated migration SQL

**Preview Environments:**

Railway creates preview deployments for pull requests with temporary databases for safe migration testing.

### Database Safety Rules

**PRODUCTION DATABASE RULES:**

1. **NEVER use commands that wipe data:**
   - `prisma migrate reset` - Wipes entire database
   - `prisma db push` - Skips migration history
   - `prisma migrate dev` - Only for local development

2. **ONLY use safe deployment commands:**
   - `prisma generate` - Generate Prisma Client types
   - `prisma migrate deploy` - Apply pending migrations

3. **ALWAYS make columns nullable before removing:**
   ```prisma
   // Step 1: Make nullable
   model Board {
     deprecatedField String?
   }
   
   // Step 2 (later): Remove column
   model Board {
     // deprecatedField removed
   }
   ```

4. **NEVER edit generated migration SQL files**

5. **ALWAYS test migrations on preview before production**

### Monitoring & Alerting

**MVP Monitoring:**

- Railway dashboard for backend metrics
- Upstash dashboard for Redis metrics
- Auth0 dashboard for authentication metrics
- Stripe dashboard for payment metrics

**Post-MVP Monitoring:**

- Application Performance Monitoring (APM): Sentry or LogRocket
- Infrastructure: Railway metrics + alerts
- Uptime: UptimeRobot or similar
- Error tracking: Sentry
- Analytics: PostHog (self-hosted)

**Alerts to Configure:**

- Database CPU >80%
- Database storage >80%
- API error rate >5%
- WebSocket disconnection rate >20%
- Stripe payment failure
- Auth0 authentication failure spike

### Backup & Disaster Recovery

**Database Backups:**

- Railway automatic daily backups
- Restore via Railway dashboard if needed

**Redis:**

- No persistent backups (ephemeral data only)
- Board state persisted to PostgreSQL every 10 min

**Recovery Plan:**

1. Identify outage scope (DB, backend, frontend)
2. Check Railway status page
3. Restore from last known good backup
4. Replay missing transactions if possible
5. Notify users of data loss window

---

## Testing Strategy

### Testing Scope

**MVP Phase:**

- Playwright automated tests for critical paths
- Focus on multi-browser sync scenarios
- Network resilience testing

**Post-MVP:**

- Extended Playwright test coverage
- Load testing (optional)

### Critical Test Scenarios

**1. Real-Time Object Sync**

Setup:
- Open board in Browser A (Chrome)
- Open same board in Browser B (Firefox)

Test:
- Create sticky note in A
- Verify appears in B within 100ms
- Move sticky note in B
- Verify position updates in A within 100ms
- Edit text in A
- Verify text updates in B
- Delete sticky note in B
- Verify disappears in A

Success Criteria:
- All updates appear within latency targets
- No objects duplicated or lost
- Final state consistent across browsers

**2. Cursor Sync**

Setup:
- Two users on same board

Test:
- User A moves cursor around canvas
- Verify User B sees A's cursor with name label
- Verify cursor position updates smoothly (<50ms)
- User A disconnects
- Verify A's cursor disappears in B

Success Criteria:
- Cursor position accurate
- No cursor lag or jitter
- Clean removal on disconnect

**3. Presence Tracking**

Setup:
- Board initially empty

Test:
- User A joins board
- Verify A sees themselves in user list
- User B joins same board
- Verify both see each other in user list
- User A refreshes page
- Verify A rejoins and appears in B's user list
- User B closes tab
- Verify B removed from A's user list

Success Criteria:
- User list always accurate
- Reconnection handled gracefully
- No ghost users

**4. Conflict Detection**

Setup:
- Two users on same board
- One sticky note present

Test:
- User A clicks sticky note to edit text
- User B clicks same sticky note to edit text
- User A types "Hello" and saves
- Verify User B sees conflict warning
- User B chooses "Keep my changes" (typed "World")
- Verify final state is "World" (B's version)

Alternative:
- User B chooses "Accept their changes"
- Verify final state is "Hello" (A's version)

Success Criteria:
- Conflict warning appears
- User can choose resolution
- Final state matches choice

**5. Network Resilience**

Setup:
- User editing board actively

Test:
- Throttle network to 3G speed (Chrome DevTools)
- Create and move objects
- Verify objects still sync (slower but working)
- Disconnect network completely
- Attempt to create object
- Verify error message shown
- Reconnect network
- Verify board state recovers
- Verify objects created while offline are not lost

Success Criteria:
- Degraded but functional on slow network
- Clear error on disconnect
- Clean recovery on reconnect
- No data loss

**6. Object Count Limits**

Setup:
- Free tier user

Test:
- Create objects until reaching limit (100 for testing)
- Attempt to create one more object
- Verify error message: "Object limit reached for free tier"
- Delete one object
- Verify can create object again

Success Criteria:
- Limit enforced server-side
- Clear error message
- Limit updates after deletion

**7. Board Slot Limits**

Setup:
- Free tier user (2 board slots)

Test:
- Create board 1
- Create board 2
- Attempt to create board 3
- Verify error message: "Board slot limit reached"
- Delete board 1
- Verify can create new board
- Verify new board goes into slot 0 (not slot 2)

Success Criteria:
- Slot limit enforced
- Deleted slot reused (except slots 0-1)

**8. Auto-Save & Version History**

Setup:
- Paid tier user
- Board with objects

Test:
- Make changes to board
- Wait 1 minute
- Verify board saved to database
- Make more changes
- Wait 5 minutes (5 saves total)
- Check version history
- Verify 1 version created (every 5th save)
- Load version
- Verify objects match snapshot

Success Criteria:
- Auto-save works every 1 min
- Version snapshots created every 5 min (every 5th save)
- Versions are view-only
- Version state accurate
- Max 50 versions per board enforced

**9. Payment Failure & Board Locking**

Setup:
- Team tier user with 5 boards

Test:
- Simulate payment failure (Stripe test mode)
- Wait for webhook processing
- Verify user can view boards for 3 days (grace period)
- Verify user cannot edit boards
- After 3 days, verify boards completely locked
- Verify only boards in slots 0-1 unlockable

Success Criteria:
- Grace period enforced
- Edit lockout works
- Complete lockout after grace period
- Slots 0-1 exception works

**10. AI Rate Limiting** (Post-MVP)

Setup:
- Free tier user

Test:
- Execute 8 AI commands
- Verify warning: "2 commands remaining"
- Execute 9th command
- Verify warning: "1 command remaining"
- Execute 10th command
- Verify success
- Execute 11th command
- Verify error: "Rate limit exceeded. Resets in X minutes"
- Wait 10 minutes
- Verify can execute commands again

Success Criteria:
- Rate limit enforced
- Warnings shown at 8 and 9 commands
- Hard stop at 10 commands
- Reset after 10 minutes

### Playwright Test Structure

**Example Test:**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Real-Time Object Sync', () => {
  test('object created in one browser appears in another', async ({ browser }) => {
    // Setup two browser contexts
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()
    
    // Login both users
    await loginAs(pageA, 'user1@example.com')
    await loginAs(pageB, 'user2@example.com')
    
    // Navigate to same board
    const boardId = await createBoard(pageA, 'Test Board')
    await pageB.goto(`/board/${boardId}`)
    
    // Create sticky note in page A
    await pageA.click('[data-testid="tool-sticky"]')
    await pageA.click('[data-testid="canvas"]', { position: { x: 100, y: 100 } })
    await pageA.fill('[data-testid="sticky-text"]', 'Hello World')
    
    // Verify appears in page B within 100ms
    await expect(pageB.locator('[data-testid="sticky-note"]')).toBeVisible({ timeout: 100 })
    await expect(pageB.locator('[data-testid="sticky-text"]')).toHaveText('Hello World')
    
    // Cleanup
    await contextA.close()
    await contextB.close()
  })
})
```

### Network Throttling Tests

**Chrome DevTools Network Throttling:**

```typescript
test('sync works on slow network', async ({ page, context }) => {
  // Enable network throttling
  const client = await context.newCDPSession(page)
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: 50 * 1024 / 8, // 50 kbps
    uploadThroughput: 50 * 1024 / 8,
    latency: 500 // 500ms
  })
  
  // Run sync tests
  // ...
})
```

### Load Testing (Optional)

**Tool:** Artillery or k6

**Scenario:**

```yaml
# artillery-config.yml
config:
  target: 'wss://collabboard-backend.up.railway.app'
  phases:
    - duration: 60
      arrivalRate: 10 # 10 new users per second
      
scenarios:
  - name: "Join board and create objects"
    engine: socketio
    flow:
      - emit:
          channel: "authenticate"
          data:
            token: "{{ $randomString() }}"
      - emit:
          channel: "join_board"
          data:
            boardId: "test-board-123"
      - think: 1
      - emit:
          channel: "object:create"
          data:
            boardId: "test-board-123"
            object:
              type: "sticky"
              x: "{{ $randomNumber(0, 1000) }}"
              y: "{{ $randomNumber(0, 1000) }}"
              text: "Test note"
              color: "#ffeb3b"
```

**Run:**

```bash
artillery run artillery-config.yml
```

**Success Criteria:**

- 100 concurrent users: <100ms avg response time
- 500 concurrent users: <200ms avg response time
- 1000 concurrent users: <500ms avg response time
- 0% error rate under load

---

## Cost Analysis

### Development & Testing Costs (7 Days)

| Service | Tier | Actual Spend |
|---------|------|--------------|
| Railway Backend | Starter ($7/mo) | ~$1.60 (prorated 7 days) |
| Railway PostgreSQL | Usage-based | ~$5-10 (estimate) |
| Upstash Redis | Free (10k cmd/day) | $0 |
| Auth0 | Free (7,500 users/mo) | $0 |
| Stripe | Test mode | $0 |
| Anthropic Claude API | Pay-per-use | ~$10-15 (see calculation below) |
| Vercel | Free | $0 |
| **Total** | | **~$17-27** |

**Anthropic API Cost Calculation (Development):**

Assuming 500 AI command tests during development:
- Average input: 800 tokens (board state + command)
- Average output: 1200 tokens (operations + response)
- Total per command: 2000 tokens

Claude Sonnet 4.5 pricing:
- Input: $3 per million tokens
- Output: $15 per million tokens

Cost calculation:
- Input: 500 commands × 800 tokens × $3/1M = **$1.20**
- Output: 500 commands × 1200 tokens × $15/1M = **$9.00**
- **Total: ~$10.20**

*Note: Actual testing may vary. With extensive debugging, budget $15-20 for safety.*

### Production Cost Projections

**Assumptions:**
- Average AI commands per user per month: 20 (10 sessions × 2 commands/session)
- Average sessions per user per month: 10
- Average boards per user: 2 (free), 5 (team), 20 (enterprise)
- Active concurrent ratio: 5-10%
- Token count per AI command: ~2000 tokens (800 input, 1200 output)

**Cost Breakdown by User Scale:**

#### 100 Users

**Infrastructure:**
- Railway Backend: $7/month
- Railway PostgreSQL (1GB): $5/month
- Upstash Redis (free tier): $0
- Total Infrastructure: $12/month

**Variable Costs:**
- Anthropic API: 
  - Commands: 100 users × 20 commands/mo = 2,000 commands
  - Input tokens: 2,000 × 800 = 1.6M tokens → $4.80
  - Output tokens: 2,000 × 1,200 = 2.4M tokens → $36.00
  - **Anthropic Total: ~$41/month**
- Stripe fees (assume 10% paid users): 10 users × $20/mo × 2.9% = ~$6/month
- Total Variable: ~$47/month

**Total: ~$59/month**
**Per User: $0.59**

#### 1,000 Users

**Infrastructure:**
- Railway Backend: $20/month (scaled instance)
- Railway PostgreSQL (10GB): $20/month
- Upstash Redis (paid tier): $10/month
- Total Infrastructure: $50/month

**Variable Costs:**
- Anthropic API: 1,000 users × 20 commands/mo × (1500 tokens) = 30M tokens
  - ~$90 input + ~$450 output = ~$540/month
- Stripe fees (assume 20% paid): 200 users × $20/mo × 2.9% = ~$116/month
- Total Variable: ~$656/month

**Total: ~$706/month**
**Per User: $0.71**

#### 10,000 Users

**Infrastructure:**
- Railway Backend (3 instances): $60/month OR AWS ECS: ~$150/month
- PostgreSQL (AWS RDS): ~$200/month
- Redis (AWS ElastiCache): ~$50/month
- Total Infrastructure: ~$400/month

**Variable Costs:**
- Anthropic API: 10,000 users × 20 commands/mo = 300M tokens
  - ~$900 input + ~$4,500 output = ~$5,400/month
- Stripe fees (30% paid): 3,000 users × $20/mo × 2.9% = ~$1,740/month
- Total Variable: ~$7,140/month

**Total: ~$7,540/month**
**Per User: $0.75**

#### 100,000 Users

**Infrastructure:**
- AWS ECS (10 instances): ~$500/month
- AWS RDS (multi-AZ): ~$800/month
- AWS ElastiCache (cluster): ~$200/month
- AWS ALB: ~$50/month
- Total Infrastructure: ~$1,550/month

**Variable Costs:**
- Anthropic API: 100,000 users × 20 commands/mo = 3B tokens
  - ~$9,000 input + ~$45,000 output = ~$54,000/month
- Stripe fees (40% paid): 40,000 users × $20/mo × 2.9% = ~$23,200/month
- Total Variable: ~$77,200/month

**Total: ~$78,750/month**
**Per User: $0.79**

**Revenue Offset (if monetized):**
- 40,000 paid users × $20/mo = $800,000/month revenue
- Costs: $78,750/month
- Gross Margin: ~90%

### Cost Optimization Strategies

**Short-term (MVP to 1k users):**
- Stay on Railway + Upstash free tiers
- Cache board state aggressively to reduce DB reads
- Implement AI command caching (same command = same result)
- Rate limit AI commands strictly

**Medium-term (1k to 10k users):**
- Migrate to AWS for better pricing at scale
- Implement connection pooling (PgBouncer)
- Cache AI responses for common templates
- Add CDN for static assets (CloudFlare)

**Long-term (10k+ users):**
- Multi-region deployment for latency
- Read replicas for PostgreSQL
- Horizontal scaling with load balancer
- Background job processing for AI (queue instead of synchronous)
- Consider self-hosting Anthropic alternatives (Llama, etc.)

---

## Build Sequence

**Purpose:** This section provides a phased implementation strategy. Each phase builds on the previous and includes validation checkpoints.

**How to Use This:**
- Work through phases sequentially
- Complete each phase fully before moving to the next
- Test thoroughly at each validation checkpoint
- Report results and verify everything works before proceeding
- Move at your own pace - phases may take longer or shorter than expected
- Focus on quality over speed - a working phase is better than rushing ahead

**Critical Rule:** Stop after each phase, test thoroughly, and report results before proceeding. This prevents compounding issues and ensures a solid foundation at each step.

---

### Phase 1: Monorepo Setup & Backend Foundation

**Goals:**
- Monorepo structure created with workspaces
- Shared package set up with types and schemas
- Express server running in apps/backend
- PostgreSQL connected via Prisma
- Auth0 JWT validation working
- Basic REST endpoints functional

**Tasks:**
1. **Initialize monorepo structure:**
   ```bash
   mkdir collabboard
   cd collabboard
   npm init -y
   # Set up root package.json with workspaces
   mkdir -p apps/backend apps/frontend packages/shared
   ```

2. **Set up shared package:**
   ```bash
   cd packages/shared
   npm init -y
   # Add types, schemas, constants (from Project Structure section)
   # Create src/index.ts to export everything
   ```

3. **Initialize backend:**
   ```bash
   cd apps/backend
   npm init -y
   # Add "shared": "*" to dependencies
   npm install express socket.io prisma @prisma/client ioredis jsonwebtoken jwks-rsa zod dotenv
   npm install -D typescript @types/node @types/express tsx
   ```

4. Create Prisma schema (copy from Database Schema section)
5. Run migrations: `cd apps/backend && npx prisma migrate dev --name init`
6. Implement Auth0 JWT middleware in `apps/backend/src/middleware/auth.ts`
7. Create REST endpoints using types from `shared` package
8. Test endpoints with Postman/curl

**Validation Checkpoint:**
- [ ] Monorepo structure matches Project Structure section
- [ ] Root `npm install` works and installs all workspaces
- [ ] Shared package exports types correctly
- [ ] Backend imports from 'shared' work (e.g., `import { Board } from 'shared'`)
- [ ] Server starts without errors on port 3001
- [ ] Database migrations run successfully
- [ ] Auth0 JWT validation rejects invalid tokens
- [ ] Can create and fetch boards via REST API
- [ ] All endpoints return proper error codes (401, 403, 500)

**STOP HERE** and report results before proceeding to Phase 2.

---

### Phase 2: WebSocket Infrastructure

**Goals:**
- Socket.io server running alongside Express
- JWT authentication for WebSocket connections
- Room-based architecture (one room per board)
- Basic presence tracking in Redis

**Tasks:**
1. Set up Socket.io server in `src/websocket/server.ts`
2. Implement WebSocket JWT authentication middleware
3. Create Redis connection (`src/utils/redis.ts`)
4. Implement `board:join` and `board:leave` handlers
5. Implement presence tracking (Redis with 30s TTL)
6. Implement cursor sync (`cursor:move` event with throttling)
7. Test with two browser windows (can use plain HTML + Socket.io-client)

**Validation Checkpoint:**
- [ ] WebSocket connection succeeds with valid JWT
- [ ] WebSocket connection fails with invalid JWT
- [ ] User can join a board room
- [ ] Presence shows who's online in Redis
- [ ] Cursor movement syncs between two clients in <100ms
- [ ] User disappears from presence after 30s of inactivity

**STOP HERE** and report results before proceeding to Phase 3.

---

### Phase 3: Frontend Canvas & Basic Objects

**Goals:**
- Fabric.js canvas initialized
- Pan/zoom working smoothly
- Can create sticky notes and rectangles
- Objects render correctly on canvas

**Tasks:**
1. Initialize React + Vite project
2. Install: Fabric.js, Socket.io-client, Zustand, Auth0 React SDK
3. Set up Auth0 React provider in `main.tsx`
4. Create Canvas component with Fabric.js initialization
5. Implement pan (space + drag) and zoom (mouse wheel)
6. Implement toolbar with tool selection UI
7. Implement sticky note creation with text editing
8. Implement rectangle/circle creation
9. Implement object selection, movement, and resize
10. Test locally (no sync yet - just canvas interactions)

**Validation Checkpoint:**
- [ ] Canvas renders full viewport
- [ ] Pan with spacebar + drag works smoothly
- [ ] Zoom with mouse wheel works (limit: 0.1x to 20x)
- [ ] Can create sticky notes with editable text
- [ ] Can create rectangles and circles with color
- [ ] Can select and move objects
- [ ] Objects maintain proper z-index stacking

**STOP HERE** and report results before proceeding to Phase 4.

---

### Phase 4: Real-Time Sync Integration

**Goals:**
- Frontend connects to WebSocket backend
- Object creation/update/deletion syncs across clients
- Multiplayer cursors working
- No sync glitches or duplicates

**Tasks:**
1. Implement `useWebSocket` hook
2. Connect Fabric.js events to WebSocket:
   - `object:added` → `socket.emit('object:create')`
   - `object:modified` → `socket.emit('object:update')`
   - `object:removed` → `socket.emit('object:delete')`
3. Implement backend WebSocket handlers:
   - Validate schema with Zod
   - Save to database
   - Broadcast to room
4. Implement client-side sync listeners:
   - `object:created` → add to canvas
   - `object:updated` → update canvas
   - `object:deleted` → remove from canvas
5. Implement multiplayer cursors component
6. Implement conversion utilities (`canvasSync.ts`)
7. Test with 3+ browser windows simultaneously

**Validation Checkpoint:**
- [ ] Object created in window A appears in window B instantly
- [ ] Object moved in window A updates in window B in <200ms
- [ ] Object deleted in window A disappears in window B
- [ ] Cursors show name labels and colors
- [ ] Cursor movement is smooth (60fps throttled)
- [ ] No duplicate objects created
- [ ] No sync race conditions or glitches

**STOP HERE** and report results before proceeding to Phase 5.

---

### Phase 5: Persistence & Conflict Handling

**Goals:**
- Auto-save worker saves boards every 60 seconds (1 minute)
- Board state persists across refreshes
- Conflict detection when users edit same object
- Conflict resolution modal working

**Tasks:**
1. Implement client-side editing state tracking
2. Implement conflict detection logic
3. Create ConflictModal component with 3 options: Use remote / Keep local / Merge
4. Implement auto-save background worker (`src/workers/autoSave.ts`) - runs every 60 seconds
5. Mark boards "dirty" when objects change
6. Save dirty boards to PostgreSQL every 60 seconds
7. Load board state from DB on `board:join`
8. Test simultaneous edits of same object

**Validation Checkpoint:**
- [ ] Board state persists after all users leave and return
- [ ] Refreshing browser reloads saved board state
- [ ] Conflict modal appears when two users edit same object simultaneously
- [ ] User can choose conflict resolution method
- [ ] No data loss during auto-save cycles
- [ ] Auto-save doesn't block WebSocket operations

**STOP HERE** and report results before proceeding to Phase 6.

---

### Phase 6: Additional Features

**Goals:**
- Frames, connectors, text elements working
- Object rotation implemented
- Multi-select functional
- Copy/paste working

**Tasks:**
1. Add Frame type (grouping container)
2. Add Connector type (lines/arrows between objects)
3. Add standalone Text type
4. Implement rotation handles in Fabric.js
5. Implement multi-select (shift-click and drag-to-select)
6. Implement copy/paste (Ctrl+C/Ctrl+V)
7. Implement delete (Delete key)
8. Test all object types sync properly

**Validation Checkpoint:**
- [ ] Can create frames and group objects visually
- [ ] Can create connectors between objects with anchors
- [ ] Can create standalone text elements
- [ ] Can rotate objects and sync rotation
- [ ] Can select multiple objects and move together
- [ ] Copy/paste creates new objects with offset position
- [ ] Delete removes objects and syncs deletion

**STOP HERE** and report results before proceeding to Phase 7.

---

### Phase 7: Subscription System

**Goals:**
- Stripe checkout working
- Subscription tiers enforced (board slots, object limits)
- Webhook handler processing subscription events
- Upgrade/downgrade flows functional

**Tasks:**
1. Create Subscription model in Prisma
2. Run migration
3. Implement Stripe checkout session endpoint
4. Implement Stripe customer portal endpoint
5. Implement webhook handler for: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed
6. Enforce board slot limits on board creation
7. Enforce object count limits on object creation
8. Create upgrade modal UI
9. Create usage meter component
10. Test full upgrade flow in Stripe test mode

**Validation Checkpoint:**
- [ ] Free user blocked at 3 boards
- [ ] Free user blocked at 100 objects per board
- [ ] Stripe checkout redirects correctly
- [ ] Webhook updates subscription status in database
- [ ] Upgraded user has increased limits
- [ ] Usage meter shows correct counts
- [ ] Payment failure handled gracefully

**STOP HERE** and report results before proceeding to Phase 8.

---

### Phase 8: Testing & Polish

**Goals:**
- All critical bugs fixed
- Performance acceptable under load
- Cross-browser testing complete
- E2E tests passing

**Tasks:**
1. Write unit tests for services (`boardService`, `syncService`)
2. Write integration tests for WebSocket events
3. Write Playwright E2E tests: login → create board → collaborate
4. Test network throttling (slow 3G)
5. Test network disconnect/reconnect
6. Test with 5+ concurrent users
7. Fix critical bugs
8. Test on Firefox and Safari
9. Performance profiling

**Validation Checkpoint:**
- [ ] Unit tests pass (70%+ coverage for services)
- [ ] Integration tests pass
- [ ] E2E tests pass consistently
- [ ] Can handle 5+ concurrent users without degradation
- [ ] Cursor sync <100ms on deployed app
- [ ] Object sync <250ms on deployed app
- [ ] Works on Firefox and Safari
- [ ] No crashes or data loss under load

**STOP HERE** and report results before proceeding to Phase 9.

---

### Phase 9: Deployment & Documentation

**Goals:**
- Backend deployed to Railway
- Frontend deployed to Vercel
- Production environment variables configured
- Documentation complete

**Tasks:**
1. Deploy backend to Railway
2. Deploy frontend to Vercel
3. Configure production env vars on Railway
4. Configure production env vars on Vercel
5. Update Auth0 URLs for production
6. Test production deployment end-to-end
7. Write comprehensive README
8. Complete AI Development Log
9. Complete AI Cost Analysis
10. Record demo video (3-5 min)
11. Create social media post
12. Submit project

**Validation Checkpoint:**
- [ ] Production backend is publicly accessible
- [ ] Production frontend is publicly accessible
- [ ] Can authenticate in production
- [ ] Can create boards and collaborate in production
- [ ] Real-time sync works in production
- [ ] README has clear setup instructions
- [ ] AI Dev Log documents tools and learnings
- [ ] Cost analysis shows 100/1k/10k/100k projections
- [ ] Demo video covers all key features
- [ ] Social post published

**PROJECT COMPLETE!**

---

## Development Roadmap

### Pre-Development Setup

**Account Setup:**
- [ ] Create Railway account, connect GitHub
- [ ] Create Auth0 account, configure application
- [ ] Create Upstash account, create Redis database
- [ ] Create Stripe account, enable test mode
- [ ] Create Vercel account, connect GitHub
- [ ] Create GitHub repository for monorepo

**Environment Configuration:**
- [ ] Set up Railway environment variables
- [ ] Set up Vercel environment variables
- [ ] Configure Auth0 callback URLs
- [ ] Test database connection
- [ ] Test Redis connection

### Implementation Phases

**Note:** Follow the detailed Build Sequence (Section 15) for step-by-step implementation. This roadmap provides a high-level overview of features to build.

**Phase 1: MVP Foundation**
- [ ] Monorepo structure with shared package
- [ ] Backend foundation with Prisma + Express + Socket.io
- [ ] Frontend foundation with React + Vite + Fabric.js
- [ ] Real-time sync core (WebSocket connection, presence, cursor broadcast)
- [ ] Basic board object CRUD operations
- [ ] Infinite board with pan/zoom
- [ ] Sticky notes with editable text
- [ ] At least one shape type (rectangle or circle)
- [ ] Create, move, and edit objects
- [ ] Real-time sync between 2+ users
- [ ] Multiplayer cursors with name labels
- [ ] Presence awareness (who's online)
- [ ] User authentication (Auth0)
- [ ] Deployed and publicly accessible

**Phase 2: Additional Object Types & Features**
- [ ] Frames (grouping containers)
- [ ] Connectors (lines/arrows between objects)
- [ ] Standalone text elements
- [ ] Object rotation
- [ ] Multi-select (shift-click and drag-to-select)
- [ ] Copy/paste
- [ ] Delete operations

**Phase 3: Persistence & Conflict Handling**
- [ ] Auto-save background worker (every 60 seconds)
- [ ] Conflict detection (client-side timestamp checking)
- [ ] Conflict resolution UI modal
- [ ] Board state persistence across sessions
- [ ] Network disconnect/reconnect handling
- [ ] Board soft delete (30-day retention)

**Phase 4: Subscription System**
- [ ] Subscription database schema
- [ ] Stripe checkout flow integration
- [ ] Stripe webhook handler (subscription events)
- [ ] Tier limit enforcement (board slots, object count)
- [ ] Payment failure grace period handling
- [ ] Subscription upgrade/downgrade flows
- [ ] Usage meter UI

**Phase 5: Version History**
- [ ] Version history database schema
- [ ] Auto-snapshot background worker (every 5 minutes / every 5th auto-save)
- [ ] Manual snapshot creation (team/enterprise)
- [ ] Version list API endpoint
- [ ] Version view UI
- [ ] Paid tier restriction enforcement
- [ ] Max 50 versions per board limit

**Phase 6: AI Agent (Post-MVP)**
- [ ] Function calling schema design
- [ ] Anthropic API integration
- [ ] Rate limiting for AI commands
- [ ] Batch operation execution
- [ ] Creation commands (sticky notes, shapes, frames)
- [ ] Manipulation commands (move, resize, color change)
- [ ] Layout commands (grid arrangement, spacing)
- [ ] Complex multi-step commands (SWOT analysis, templates)

**Phase 7: Testing & Polish**
- [ ] Unit tests for services (70%+ coverage)
- [ ] Integration tests for WebSocket events
- [ ] Playwright E2E tests (critical user flows)
- [ ] Performance testing (network throttling)
- [ ] Load testing (5+ concurrent users)
- [ ] Cross-browser testing (Chrome, Firefox, Safari)
- [ ] Bug fixes

**Phase 8: Documentation & Submission**
- [ ] Comprehensive README with setup instructions
- [ ] Architecture overview documentation
- [ ] AI Development Log
- [ ] AI Cost Analysis (100/1k/10k/100k projections)
- [ ] Demo video (3-5 minutes)
- [ ] Social media post
- [ ] Final deployment verification
- [ ] Project submission
- [ ] Submit project

---

## Account Setup Checklist

### Railway
1. Visit railway.app
2. Sign up with GitHub
3. Create new project
4. Add PostgreSQL database (automatic provisioning)
5. Add credit card for usage-based billing
6. Note: Railway URL will be `https://[project-name].up.railway.app`

### Auth0
1. Visit auth0.com
2. Sign up (free tier)
3. Create application:
   - Type: Single Page Application
   - Name: CollabBoard
4. Configure settings:
   - Allowed Callback URLs: `http://localhost:5173/callback, https://[vercel-url].vercel.app/callback`
   - Allowed Logout URLs: `http://localhost:5173, https://[vercel-url].vercel.app`
   - Allowed Web Origins: `http://localhost:5173, https://[vercel-url].vercel.app`
   - Allowed Origins (CORS): `http://localhost:5173, https://[vercel-url].vercel.app`
5. Enable Connections: Google, GitHub (optional)
6. Save: Domain, Client ID, Client Secret
7. Create API:
   - Name: CollabBoard API
   - Identifier: `https://collabboard-api`
   - Save Identifier (this is your AUTH0_AUDIENCE)

### Upstash Redis
1. Visit upstash.com
2. Sign up (free tier)
3. Create database:
   - Name: collabboard-redis
   - Region: Choose closest to Railway region (us-east-1)
   - Type: Regional
4. Save Redis URL (includes auth credentials)

### Stripe
1. Visit stripe.com
2. Sign up
3. Stay in Test Mode for entire development
4. Create products:
   - Product 1: Small Team ($20/month)
   - Product 2: Enterprise (custom pricing)
5. Set up webhook:
   - Endpoint: `https://[railway-url].up.railway.app/webhooks/stripe`
   - Events to listen: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
   - Save Webhook Secret
6. Save: Secret Key, Publishable Key

### Anthropic (Post-MVP)
1. Visit console.anthropic.com
2. Sign up
3. Add payment method (required for API access)
4. Create API key
5. Save API key
6. Note: Monitor usage in dashboard to track costs

### Vercel
1. Visit vercel.com
2. Sign up with GitHub
3. No payment required (free tier sufficient)
4. Import frontend repository when ready to deploy

### GitHub
1. Create repository: `collabboard-backend`
   - Initialize with README
   - Add .gitignore (Node)
   - Private or public (your choice)
2. Create repository: `collabboard-frontend`
   - Initialize with README
   - Add .gitignore (Node)
   - Private or public (your choice)
3. Clone both repositories locally

---

## Appendix: Technology Decision Matrix

### Decision: Railway vs. AWS

| Factor | Railway | AWS |
|--------|---------|-----|
| Setup Time | 5 minutes | Hours to days |
| WebSocket Support | Native | Requires ALB + ECS |
| Database | One-click PostgreSQL | Manual RDS setup |
| Cost (0-1k users) | $12/month | $50-100/month |
| Cost (10k+ users) | $200-400/month | $400-800/month |
| Scalability | Good to 5k concurrent | Excellent to millions |
| Developer Experience | Excellent | Complex |
| **Decision** | **Use for MVP** | **Migrate at 5k+ users** |

### Decision: Fabric.js vs. Konva.js

| Factor | Fabric.js | Konva.js |
|--------|-----------|----------|
| Feature Set | Rich (filters, patterns, groups) | Moderate (basic shapes, transforms) |
| Learning Curve | Steeper | Gentler |
| Performance | Good | Excellent |
| Bundle Size | Larger (~200kb) | Smaller (~100kb) |
| Documentation | Extensive | Good |
| Community | Large | Moderate |
| **Decision** | **Primary choice** | **Fallback if time pressure** |

### Decision: Zustand vs. Redux Toolkit

| Factor | Zustand | Redux Toolkit |
|--------|---------|---------------|
| Boilerplate | Minimal | Moderate |
| Learning Curve | Easy | Moderate |
| DevTools | Browser extension | Excellent Redux DevTools |
| TypeScript Support | Excellent | Excellent |
| Community | Growing | Massive |
| **Decision** | **Use for MVP** | **Consider if need advanced debugging** |

### Decision: Last-Write-Wins vs. CRDT

| Factor | Last-Write-Wins | CRDT (Yjs) |
|--------|-----------------|------------|
| Implementation Complexity | Simple | Complex |
| Conflict Resolution | Data loss possible | No data loss |
| Time to Implement | 4-6 hours | 12-16 hours |
| Suitable for Whiteboard | Yes (rare conflicts) | Yes (better UX) |
| **Decision** | **Use for MVP** | **Consider post-MVP if conflicts common** |

---

## Glossary

**CRDT:** Conflict-free Replicated Data Type - data structures that merge concurrent changes automatically

**JWT:** JSON Web Token - standard for securely transmitting information between parties

**ORM:** Object-Relational Mapping - technique for converting data between incompatible type systems (Prisma in this project)

**Prisma:** Modern TypeScript ORM for Node.js with type-safe database access and automatic migrations

**Redis:** In-memory key-value store, used for caching and real-time data

**Socket.io:** Library for real-time WebSocket communication with fallback support

**TTL:** Time To Live - expiration time for cached data in Redis

**WebSocket:** Protocol for full-duplex communication over a single TCP connection

**Zero Trust:** Security model where no user or system is trusted by default

**Zod:** TypeScript schema validation library for runtime type checking

---

## Contact & Support

**For Questions:**
- Assignment clarifications: Contact instructors via Slack
- Technical blockers: Post in #help channel
- AI development methodology: Reference Pre-Search and AI Development Log requirements

**Resources:**
- Railway Docs: https://docs.railway.app
- Auth0 Docs: https://auth0.com/docs
- Socket.io Docs: https://socket.io/docs
- Fabric.js Docs: http://fabricjs.com/docs
- Stripe Docs: https://stripe.com/docs
- Anthropic Docs: https://docs.anthropic.com

---

**Document Version:** 1.0  
**Last Updated:** February 17, 2026  
**Status:** Ready for Development
