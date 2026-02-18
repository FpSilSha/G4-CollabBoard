import { type ReactNode } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import styles from './AuthGate.module.css';

interface AuthGateProps {
  children: ReactNode;
}

/**
 * PRIMARY authentication boundary.
 *
 * Wraps the entire app and manages four states:
 *
 *   1. Landing   — unauthenticated, shows login button (no auto-redirects)
 *   2. Loading   — Auth0 SDK initializing or processing callback
 *   3. Error     — authentication failed, shows retry button
 *   4. Authenticated — renders children (the full app)
 *
 * SECURITY: This is the first gate. App.tsx has a secondary defensive check.
 *
 * URL PRESERVATION: loginWithRedirect saves the current pathname in
 * appState.returnTo so that after Auth0 callback, onRedirectCallback
 * in main.tsx navigates back to the original URL (e.g. /board/:boardId).
 */
export function AuthGate({ children }: AuthGateProps) {
  const { isLoading, isAuthenticated, error, loginWithRedirect } = useAuth0();

  const handleLogin = () => {
    loginWithRedirect({
      appState: { returnTo: window.location.pathname },
    });
  };

  // State 2: SDK initializing or processing Auth0 callback (?code=&state=)
  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.content}>
          <h1 className={styles.title}>G4 CollabBoard</h1>
          <div className={styles.spinner} />
          <p className={styles.subtitle}>Authenticating...</p>
        </div>
      </div>
    );
  }

  // State 3: Auth0 returned an error
  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.content}>
          <h1 className={styles.title}>G4 CollabBoard</h1>
          <p className={styles.errorMessage}>Authentication failed</p>
          <p className={styles.errorDetail}>{error.message}</p>
          <button
            className={styles.loginButton}
            onClick={handleLogin}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // State 1: Not authenticated — show landing with login button
  if (!isAuthenticated) {
    return (
      <div className={styles.container}>
        <div className={styles.content}>
          <h1 className={styles.title}>G4 CollabBoard</h1>
          <p className={styles.subtitle}>Real-time collaborative whiteboard</p>
          <button
            className={styles.loginButton}
            onClick={handleLogin}
          >
            Login with Auth0
          </button>
        </div>
      </div>
    );
  }

  // State 4: Authenticated — render the full app
  return <>{children}</>;
}
