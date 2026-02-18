import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import { Auth0Provider, type AppState } from '@auth0/auth0-react';
import { AuthGate } from './components/auth/AuthGate';
import { App } from './App';
import './index.css';

// Auth0 configuration from environment variables.
const auth0Domain = import.meta.env.VITE_AUTH0_DOMAIN || '';
const auth0ClientId = import.meta.env.VITE_AUTH0_CLIENT_ID || '';
const auth0Audience = import.meta.env.VITE_AUTH0_AUDIENCE || '';

const rootEl = document.getElementById('root');

if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

/**
 * Auth0ProviderWithNavigate must be a child of BrowserRouter
 * so onRedirectCallback can use useNavigate() to restore the
 * pre-login URL (e.g. /board/:boardId) after Auth0 callback.
 */
function Auth0ProviderWithNavigate({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

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
    <BrowserRouter>
      <Auth0ProviderWithNavigate>
        <AuthGate>
          <App />
        </AuthGate>
      </Auth0ProviderWithNavigate>
    </BrowserRouter>
  </React.StrictMode>
);
