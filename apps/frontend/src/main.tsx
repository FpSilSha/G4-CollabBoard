import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import { Auth0Provider, Auth0Context, type AppState } from '@auth0/auth0-react';
import { AuthGate } from './components/auth/AuthGate';
import { App } from './App';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './index.css';

// Auth0 configuration from environment variables.
const auth0Domain = import.meta.env.VITE_AUTH0_DOMAIN || '';
const auth0ClientId = import.meta.env.VITE_AUTH0_CLIENT_ID || '';
const auth0Audience = import.meta.env.VITE_AUTH0_AUDIENCE || '';

const rootEl = document.getElementById('root');

if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

// E2E test mode: VITE_TEST_MODE=true bypasses Auth0 entirely.
const isTestMode = import.meta.env.VITE_TEST_MODE === 'true';

// Mock Auth0 context for test mode. Provides the same shape as the
// real Auth0 SDK context so all useAuth0() calls work without errors.
// getAccessTokenSilently returns a static test token that the backend
// E2E_TEST_AUTH bypass accepts as a valid identity.
// Allow per-context token override for multi-user E2E tests.
// Each Playwright browser context sets its own token via addInitScript.
function getTestToken(): string {
  try { return localStorage.getItem('E2E_TEST_TOKEN') || 'e2e-user-1'; } catch { return 'e2e-user-1'; }
}

const testAuth0Context = {
  isAuthenticated: true,
  isLoading: false,
  user: { sub: `test|${getTestToken()}`, name: 'Test User', email: 'test@test.local' },
  error: undefined,
  getAccessTokenSilently: () => Promise.resolve(getTestToken()),
  getAccessTokenWithPopup: () => Promise.resolve(getTestToken()),
  getIdTokenClaims: () => Promise.resolve(undefined),
  loginWithRedirect: () => Promise.resolve(),
  loginWithPopup: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  handleRedirectCallback: () => Promise.resolve({ appState: {} }),
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Auth0ProviderWithNavigate must be a child of BrowserRouter
 * so onRedirectCallback can use useNavigate() to restore the
 * pre-login URL (e.g. /board/:boardId) after Auth0 callback.
 */
function Auth0ProviderWithNavigate({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  // Test mode: provide a mock Auth0 context so all useAuth0() calls
  // throughout the component tree get valid values without initializing
  // the real Auth0 SDK. This prevents "missing Auth0Provider" errors.
  if (isTestMode) {
    return (
      <Auth0Context.Provider value={testAuth0Context}>
        {children}
      </Auth0Context.Provider>
    );
  }

  if (!auth0Domain || !auth0ClientId) {
    // No Auth0 config: render app without auth wrapper (local dev fallback)
    return <>{children}</>;
  }

  const onRedirectCallback = (appState?: AppState) => {
    // After Auth0 login redirect, navigate to the page the user
    // originally visited (e.g. /board/abc-123) or fall back to /
    navigate(appState?.returnTo || '/', { replace: true });
  };

  return (
    <Auth0Provider
      domain={auth0Domain}
      clientId={auth0ClientId}
      cacheLocation="localstorage"
      useRefreshTokens={true}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: auth0Audience,
        scope: 'openid profile email offline_access',
      }}
      onRedirectCallback={onRedirectCallback}
    >
      {children}
    </Auth0Provider>
  );
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Auth0ProviderWithNavigate>
          <AuthGate>
            <App />
          </AuthGate>
        </Auth0ProviderWithNavigate>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
