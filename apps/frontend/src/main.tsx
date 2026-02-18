import React from 'react';
import ReactDOM from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import { App } from './App';
import './index.css';

// Auth0 configuration from environment variables.
// In Phase 3, these may be empty/placeholder strings.
const auth0Domain = import.meta.env.VITE_AUTH0_DOMAIN || '';
const auth0ClientId = import.meta.env.VITE_AUTH0_CLIENT_ID || '';
const auth0Audience = import.meta.env.VITE_AUTH0_AUDIENCE || '';

const rootEl = document.getElementById('root');

if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

// Conditionally wrap with Auth0Provider only if credentials are configured.
// This prevents Auth0 SDK errors when running without env vars in Phase 3.
function AppWithProviders() {
  if (auth0Domain && auth0ClientId) {
    return (
      <Auth0Provider
        domain={auth0Domain}
        clientId={auth0ClientId}
        authorizationParams={{
          redirect_uri: window.location.origin,
          audience: auth0Audience,
        }}
      >
        <App />
      </Auth0Provider>
    );
  }

  // No Auth0 config: render app without auth wrapper (Phase 3 local dev)
  return <App />;
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <AppWithProviders />
  </React.StrictMode>
);
