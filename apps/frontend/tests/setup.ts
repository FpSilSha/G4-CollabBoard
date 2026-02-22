import { vi } from 'vitest';

// ─── Mock fabric.js (Canvas API not available in jsdom) ──────────────────────
vi.mock('fabric', () => {
  const mockObject = {
    set: vi.fn().mockReturnThis(),
    get: vi.fn(),
    setCoords: vi.fn(),
    getBoundingRect: vi.fn(() => ({ left: 0, top: 0, width: 100, height: 100 })),
    getObjects: vi.fn(() => []),
    data: {},
  };

  return {
    fabric: {
      Canvas: vi.fn().mockImplementation(() => ({
        add: vi.fn(),
        remove: vi.fn(),
        clear: vi.fn(),
        renderAll: vi.fn(),
        requestRenderAll: vi.fn(),
        getObjects: vi.fn(() => []),
        on: vi.fn(),
        off: vi.fn(),
        setViewportTransform: vi.fn(),
        getVpCenter: vi.fn(() => ({ x: 400, y: 300 })),
        dispose: vi.fn(),
        moveTo: vi.fn(),
        bringToFront: vi.fn(),
        sendToBack: vi.fn(),
        zoomToPoint: vi.fn(),
        relativePan: vi.fn(),
        viewportTransform: [1, 0, 0, 1, 0, 0],
      })),
      Object: vi.fn().mockImplementation(() => mockObject),
      Rect: vi.fn().mockImplementation(() => ({ ...mockObject, type: 'rect' })),
      Circle: vi.fn().mockImplementation(() => ({ ...mockObject, type: 'circle' })),
      Text: vi.fn().mockImplementation(() => ({ ...mockObject, type: 'text', width: 100, height: 20 })),
      Textbox: vi.fn().mockImplementation(() => ({ ...mockObject, type: 'textbox', width: 200, height: 200 })),
      Group: vi.fn().mockImplementation(() => ({ ...mockObject, type: 'group', getObjects: vi.fn(() => []) })),
      Polygon: vi.fn().mockImplementation(() => ({ ...mockObject, type: 'polygon' })),
      Line: vi.fn().mockImplementation(() => ({ ...mockObject, type: 'line' })),
      Image: {
        fromURL: vi.fn(),
      },
      util: {
        transformPoint: vi.fn((pt) => pt),
        invertTransform: vi.fn((t) => t),
        multiplyTransformMatrices: vi.fn(),
      },
    },
  };
});

// ─── Mock socket.io-client ───────────────────────────────────────────────────
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
    id: 'mock-socket-id',
  })),
}));

// ─── Mock Auth0 ──────────────────────────────────────────────────────────────
vi.mock('@auth0/auth0-react', () => ({
  useAuth0: vi.fn(() => ({
    isAuthenticated: true,
    isLoading: false,
    user: { sub: 'auth0|user-1', name: 'Test User', email: 'test@example.com' },
    getAccessTokenSilently: vi.fn().mockResolvedValue('mock-token'),
    logout: vi.fn(),
    loginWithRedirect: vi.fn(),
  })),
  Auth0Provider: vi.fn(({ children }: { children: React.ReactNode }) => children),
}));

// ─── Mock CSS modules ────────────────────────────────────────────────────────
vi.mock('*.module.css', () => new Proxy({}, { get: (_t, k) => k }));

// ─── Browser APIs not in jsdom ───────────────────────────────────────────────
Object.defineProperty(window, 'crypto', {
  value: {
    randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }),
  },
});

// ─── Environment ─────────────────────────────────────────────────────────────
process.env.VITE_API_URL = 'http://localhost:3001';
process.env.VITE_AUTH0_AUDIENCE = 'https://collabboard-api';
