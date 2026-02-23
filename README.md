# NoteTime

Real-time collaborative whiteboard built with TypeScript. Multiple users can work simultaneously on shared canvases with instant synchronization, cursor presence, and an AI assistant that can create and manipulate objects on command.

---

## Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| **Frontend** | React 18, Vite 5 | UI framework and build tooling |
| **Canvas** | Fabric.js 5 | Shape rendering, object manipulation, zoom/pan |
| **State** | Zustand 4 | Client-side stores (board, presence, AI, UI) |
| **Routing** | React Router 7 | SPA navigation (dashboard, board, admin) |
| **Backend** | Express 4, Node.js | REST API server |
| **WebSocket** | Socket.io 4 | Real-time bidirectional sync |
| **Database** | PostgreSQL 16 (Prisma 5) | Persistent storage, optimistic locking |
| **Cache** | Redis 7 (ioredis) | Edit locks, session state, metrics counters |
| **Auth** | Auth0 | OAuth2 login, JWT verification |
| **AI** | Anthropic Claude (Sonnet 4 / Haiku) | Canvas commands via natural language |
| **Tracing** | LangSmith | AI tool call observability (optional) |
| **Monorepo** | npm workspaces | Shared types package across apps |
| **Testing** | Vitest | Unit tests (943 total: 738 backend + 205 frontend) |
| **Linting** | ESLint 9 | TypeScript + React Hooks rules |

### Third-Party Accounts Required

| Service | Purpose | Free Tier |
|---------|---------|-----------|
| [Auth0](https://auth0.com) | User authentication | 7,500 MAU |
| [Anthropic](https://console.anthropic.com) | AI agent (Claude API) | Pay-per-token |
| [Railway](https://railway.app) | Backend hosting + PostgreSQL | $5/mo hobby |
| [Vercel](https://vercel.com) | Frontend hosting | Free for personal |
| [Upstash](https://upstash.com) | Managed Redis (production) | 10k commands/day free |
| [LangSmith](https://smith.langchain.com) | AI tracing (optional) | Free developer tier |
| [GitHub](https://github.com) | Source control, PRs | Free |

---

## Architecture

```
                    Vercel (static)          Railway (Node.js)
                  ┌────────────────┐     ┌──────────────────────┐
                  │    React SPA   │────>│   Express + Socket.io │
                  │  Fabric.js     │<────│   Prisma ORM          │
                  │  Zustand       │ WS  │   AI Service          │
                  └────────────────┘     └──────┬───────┬────────┘
                                                │       │
                                         ┌──────┘       └──────┐
                                         v                     v
                                    PostgreSQL             Redis
                                    (Railway)            (Upstash)
                                    Boards, users,       Edit locks,
                                    versions, flags      metrics, cache
```

### Monorepo Structure

```
├── apps/
│   ├── backend/          Express + Socket.io + Prisma
│   │   ├── src/
│   │   │   ├── ai/           AI agent (classifier, executor, 14 tools)
│   │   │   ├── controllers/  REST route handlers
│   │   │   ├── services/     Business logic
│   │   │   ├── repositories/ Data access layer
│   │   │   ├── middleware/    Auth, validation, rate limiting
│   │   │   ├── websocket/    Socket.io event handlers
│   │   │   └── workers/      Auto-save background job
│   │   ├── prisma/           Schema + migrations
│   │   └── tests/
│   │
│   └── frontend/         React + Vite + Fabric.js
│       ├── src/
│       │   ├── components/   UI (canvas, toolbar, sidebar, AI chat, admin)
│       │   ├── hooks/        Canvas sync, keyboard shortcuts, object creation
│       │   ├── stores/       Zustand (boardStore, presenceStore, aiStore, uiStore)
│       │   ├── services/     API client
│       │   └── utils/        Fabric helpers, clipboard, connectors
│       └── tests/
│
├── packages/
│   └── shared/           TypeScript types, Zod schemas, constants
│
└── docker-compose.yml    Local PostgreSQL + Redis
```

---

## Getting Started

### Prerequisites

- **Node.js 18+** (npm workspaces)
- **Docker Desktop** (for local PostgreSQL + Redis)
- **Auth0 tenant** with a SPA application configured
- **Anthropic API key** (for AI features, optional)

### Setup

```bash
# Clone and install
git clone https://github.com/your-org/G4CollabBoard.git
cd G4CollabBoard
npm install

# Start local databases
docker-compose up -d

# Create env files from templates
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
# Edit both .env files with your Auth0 + Anthropic credentials

# Generate Prisma client and run migrations
cd apps/backend
npx prisma generate
npx prisma migrate deploy
cd ../..

# Start everything
npm run dev
```

- **Frontend:** http://localhost:5173
- **Backend:** http://localhost:3001
- **API docs:** http://localhost:3001/api-docs
- **Metrics:** http://localhost:3001/metrics

### Docker Services

| Service | Port | Credentials |
|---------|------|-------------|
| PostgreSQL 16 | 5432 | `collabboard` / `collabboard_dev` |
| Redis 7 | 6379 | No auth |

```bash
docker-compose up -d      # Start
docker-compose down        # Stop
docker-compose logs -f     # Logs
```

---

## Key Design Decisions

### Real-Time Sync

- **Cursor throttle:** 50ms (volatile emit, lossy is fine)
- **Object drag throttle:** 100ms (reliable emit)
- **Final state rule:** Unthrottled `object:update` on `mouseup` ensures the last position is always synced
- **Conflict strategy:** Last-Write-Wins (LWW) with optimistic locking via a `version` column on boards
- **Auto-save:** Redis cache flushed to PostgreSQL every 60 seconds via background worker
- **Version snapshots:** Every 5th save creates a `BoardVersion` row (rollback history)

### Object Identity

Every canvas object carries a `data.id` UUID on its Fabric.js instance. All lookups, syncs, and deletes use this ID — never array indices. This prevents sync race conditions when multiple users add/remove objects simultaneously.

### Auth & Demo Mode

Auth0 handles real authentication. A demo mode bypasses Auth0 entirely, providing a single ephemeral board with no backend persistence, no WebSocket, and no AI. State lives in Zustand memory only — refresh returns to login.

### AI Agent

Two-model routing: a keyword classifier sends simple commands (e.g., "create a blue circle") to Haiku and complex commands (e.g., "organize all sticky notes into a grid") to Sonnet 4. If Haiku fails with zero operations, the system retries the full command with Sonnet. A monthly budget cap prevents runaway costs.

14 tools are available to the AI: 5 creation (shapes, stickies, text, lines, connectors), 5 manipulation (move, resize, recolor, delete, modify), 2 read (viewport scan, object lookup), 1 batch operation, and 1 text element creator.

### Canvas Performance

At ~66 objects, noticeable rendering slowdown begins. The system enforces a hard cap of 2,000 active objects per board. Future optimization targets include viewport culling, object caching, and reduced re-renders.

---

## Scripts

```bash
# Root (all workspaces)
npm run dev                # Start backend + frontend in watch mode
npm run build              # Build all packages
npm run test               # Run all 943 tests
npm run lint               # Lint everything

# Backend only
npm run dev:backend        # Express + Socket.io (port 3001)

# Frontend only
npm run dev:frontend       # Vite dev server (port 5173)
```

---

## API Overview

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/me` | Current user profile |
| `PATCH` | `/auth/me` | Update name, avatar, color |
| `GET` | `/boards` | List user's boards |
| `POST` | `/boards` | Create new board |
| `GET` | `/boards/:id` | Get board + objects |
| `PATCH` | `/boards/:id` | Rename board |
| `DELETE` | `/boards/:id` | Delete board |
| `POST` | `/boards/:id/flags` | Create teleport flag |
| `POST` | `/ai/execute` | Run AI command |
| `GET` | `/ai/status` | AI budget + status |
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Real-time metrics dashboard |

### WebSocket Events

| Direction | Event | Purpose |
|-----------|-------|---------|
| Client -> Server | `board:join` | Subscribe to board changes |
| Client -> Server | `cursor:moved` | Send cursor position |
| Client -> Server | `object:create/update/delete` | Canvas mutations |
| Client -> Server | `edit:start/end` | Sticky note edit locking |
| Client -> Server | `ai:command` | AI natural language command |
| Server -> Client | `cursor:updated` | Remote cursor position |
| Server -> Client | `object:created/updated/deleted` | Broadcast mutations |
| Server -> Client | `user:joined/left` | Presence notifications |
| Server -> Client | `board:state` | Full state on reconnect |
| Server -> Client | `ai:thinking/complete` | AI progress feedback |

---

## Data Model

Core entities managed by Prisma:

- **User** — Auth0-linked profile with subscription tier, avatar, cursor color
- **Board** — Canvas with JSON objects array, version counter, thumbnail preview
- **BoardVersion** — Snapshot history (every 5th auto-save)
- **TeleportFlag** — Named canvas bookmarks with coordinates and color
- **LinkedBoard** — Shared board references (boards from other users)
- **Subscription** — Stripe-backed billing (Free / Team / Enterprise tiers)
- **AuditLog** — Action history for compliance

---

## Testing

```bash
npm run test                 # All tests (943 total)
npm run test --workspace=apps/backend    # Backend only (738 tests)
npm run test --workspace=apps/frontend   # Frontend only (205 tests)
```

Coverage thresholds: 80% lines/functions, 75% branches.

Canvas hooks (`useCanvas`, `useCanvasSync`, `useObjectCreation`) require a real Fabric.js environment and are targeted for Playwright E2E tests in a future sprint.

---

## Deployment

| Component | Platform | Trigger |
|-----------|----------|---------|
| Frontend | Vercel | Push to `main` |
| Backend | Railway | Push to `main` |
| Database | Railway PostgreSQL | Managed |
| Redis | Upstash | Managed |

Both platforms auto-deploy on merge to `main`. Environment variables are configured in each platform's dashboard.

---

## Monitoring

### Built-In Metrics Dashboard

Available at `/metrics` (local and production). Auto-refreshes every 10 seconds. Tracks:

- WebSocket event counts by type
- Active connections and presence
- HTTP request counts
- Redis and DB operation counts
- Latency percentiles (p50, p95, p99)
- Active edit locks (per-object and per-user)

### LangSmith (Optional)

When `LANGCHAIN_TRACING_V2=true`, all AI tool calls, classifier decisions, and token usage are logged to LangSmith for debugging.

---

## Project Conventions

These rules are enforced across the codebase (documented in `.clauderules`):

1. All TypeScript types live in `packages/shared` — never duplicated in apps
2. Database changes use `prisma migrate` only — no raw SQL, no `db push`
3. Object identity is always `fabricObject.data.id` — never array indices
4. Cursor events use `volatile` (lossy OK), object state uses reliable delivery
5. Auto-save runs every 60s; version snapshots every 5th save
6. Optimistic locking via `version` column — Last-Write-Wins conflict resolution
