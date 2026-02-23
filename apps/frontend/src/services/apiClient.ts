import { useAuth0 } from '@auth0/auth0-react';
import { useDemoStore } from '../stores/demoStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const AUTH_PARAMS = {
  authorizationParams: {
    audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
  },
};

/**
 * Error thrown when an API call returns a non-2xx response.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type GetToken = () => Promise<string>;

async function request(
  getToken: GetToken,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const token = await getToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let errorBody: unknown;
    try { errorBody = await res.json(); } catch { errorBody = null; }
    throw new ApiError(res.status, errorBody, `API ${method} ${path} failed: ${res.status}`);
  }
  return res;
}

/** Shape of the API client returned by createApiClient / createDemoApiClient */
export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Creates an API client bound to a token getter function.
 * Each method handles token injection, base URL, Content-Type, and error normalization.
 *
 * @param getToken - Async function that returns a fresh bearer token
 */
export function createApiClient(getToken: GetToken) {
  return {
    async get<T>(path: string): Promise<T> {
      const res = await request(getToken, 'GET', path);
      return res.json() as Promise<T>;
    },
    async post<T>(path: string, body?: unknown): Promise<T> {
      const res = await request(getToken, 'POST', path, body);
      return res.json() as Promise<T>;
    },
    async patch<T>(path: string, body?: unknown): Promise<T> {
      const res = await request(getToken, 'PATCH', path, body);
      return res.json() as Promise<T>;
    },
    async put<T>(path: string, body?: unknown): Promise<T> {
      const res = await request(getToken, 'PUT', path, body);
      return res.json() as Promise<T>;
    },
    async del(path: string): Promise<void> {
      await request(getToken, 'DELETE', path);
    },
    /** Returns raw Response for cases that need status/headers (e.g. 204 No Content) */
    async raw(method: string, path: string, body?: unknown): Promise<Response> {
      return request(getToken, method, path, body);
    },
  };
}

// ============================================================
// Demo API Client — returns mock data, no network calls
// ============================================================

function createDemoApiClient(demoBoardId: string | null): ApiClient {
  const mockBoard = {
    id: demoBoardId,
    title: 'Demo Board',
    ownerId: 'demo-user',
    maxObjectsPerBoard: 100,
    version: 0,
    slot: 1,
    lastAccessedAt: new Date().toISOString(),
    objectCount: 0,
    isDeleted: false,
    thumbnail: null,
    isOwned: true,
    thumbnailVersion: -1,
  };

  const demoError = (path: string) =>
    new ApiError(403, null, `Demo mode: ${path} requires authentication`);

  return {
    async get<T>(path: string): Promise<T> {
      if (path === '/boards') {
        return { ownedBoards: [mockBoard], linkedBoards: [] } as T;
      }
      if (demoBoardId && path === `/boards/${demoBoardId}`) {
        return mockBoard as T;
      }
      throw demoError(path);
    },
    async post<T>(path: string, _body?: unknown): Promise<T> {
      throw demoError(path);
    },
    async patch<T>(path: string, body?: unknown): Promise<T> {
      // Allow local-only board title rename
      if (demoBoardId && path === `/boards/${demoBoardId}` && body && typeof body === 'object') {
        return { ...mockBoard, ...(body as Record<string, unknown>) } as T;
      }
      throw demoError(path);
    },
    async put<T>(path: string, _body?: unknown): Promise<T> {
      throw demoError(path);
    },
    async del(path: string): Promise<void> {
      throw demoError(path);
    },
    async raw(_method: string, path: string, _body?: unknown): Promise<Response> {
      throw demoError(path);
    },
  };
}

/**
 * React hook that returns an API client bound to the current Auth0 token.
 * In demo mode, returns a mock client that serves local data.
 * Use this in components/hooks that have access to the Auth0 context.
 */
export function useApiClient(): ApiClient {
  const isDemoMode = useDemoStore((s) => s.isDemoMode);
  const demoBoardId = useDemoStore((s) => s.demoBoardId);
  // Always call useAuth0() unconditionally (React hook rules).
  // In demo mode we simply don't use its return value.
  const { getAccessTokenSilently } = useAuth0();

  if (isDemoMode) {
    return createDemoApiClient(demoBoardId);
  }

  const getToken = () => getAccessTokenSilently(AUTH_PARAMS);
  return createApiClient(getToken);
}
