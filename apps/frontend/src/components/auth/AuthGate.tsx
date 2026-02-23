import { type ReactNode, useMemo } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useDemoStore } from '../../stores/demoStore';
import styles from './AuthGate.module.css';

interface AuthGateProps {
  children: ReactNode;
}

// ============================================================
// Animated Background — floating shapes over a moving dot grid
// ============================================================

const SHAPE_COLORS = [
  '#FFEB3B', '#FF9800', '#F44336', '#E91E63', '#9C27B0',
  '#3F51B5', '#2196F3', '#00BCD4', '#4CAF50', '#8BC34A',
];

interface FloatingShapeDef {
  type: 'circle' | 'rect' | 'triangle' | 'sticky';
  size: number;
  color: string;
  startX: number;   // % from left — starting position (bottom-left quadrant)
  startY: number;   // % from top  — starting position
  duration: number;  // seconds
  delay: number;     // seconds
  rotation: number;  // degrees
  opacity: number;
}

function generateFloatingShapes(count: number): FloatingShapeDef[] {
  // Seeded PRNG for deterministic shapes
  let seed = 7;
  const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; };

  const types: FloatingShapeDef['type'][] = ['circle', 'rect', 'triangle', 'sticky'];
  const shapes: FloatingShapeDef[] = [];

  for (let i = 0; i < count; i++) {
    shapes.push({
      type: types[Math.floor(rand() * types.length)],
      size: 25 + rand() * 45,
      color: SHAPE_COLORS[Math.floor(rand() * SHAPE_COLORS.length)],
      // Start from bottom-left area (will animate to top-right)
      startX: -15 + rand() * 40,
      startY: 70 + rand() * 45,
      duration: 14 + rand() * 18,
      delay: rand() * 20,
      rotation: Math.floor(rand() * 360),
      opacity: 0.25 + rand() * 0.25,
    });
  }
  return shapes;
}

function renderShape(s: FloatingShapeDef, i: number) {
  const cssVars = {
    '--duration': `${s.duration}s`,
    '--delay': `${s.delay}s`,
    '--start-rotation': `${s.rotation}deg`,
    '--shape-opacity': String(s.opacity),
    left: `${s.startX}%`,
    top: `${s.startY}%`,
  } as React.CSSProperties;

  if (s.type === 'circle') {
    return (
      <div
        key={i}
        className={styles.floatingShape}
        style={{
          ...cssVars,
          width: s.size,
          height: s.size,
          borderRadius: '50%',
          background: s.color,
        }}
      />
    );
  }

  if (s.type === 'rect') {
    return (
      <div
        key={i}
        className={styles.floatingShape}
        style={{
          ...cssVars,
          width: s.size,
          height: s.size,
          borderRadius: 4,
          background: s.color,
        }}
      />
    );
  }

  if (s.type === 'sticky') {
    // Mini sticky note shape — colored square with a folded corner effect
    return (
      <div
        key={i}
        className={styles.floatingShape}
        style={{
          ...cssVars,
          width: s.size,
          height: s.size,
          background: s.color,
          borderRadius: 3,
          boxShadow: `inset -${s.size * 0.2}px -${s.size * 0.2}px 0 rgba(0,0,0,0.1)`,
        }}
      />
    );
  }

  // triangle
  const half = s.size / 2;
  return (
    <div
      key={i}
      className={styles.floatingShape}
      style={{
        ...cssVars,
        width: 0,
        height: 0,
        background: 'transparent',
        borderLeft: `${half}px solid transparent`,
        borderRight: `${half}px solid transparent`,
        borderBottom: `${s.size}px solid ${s.color}`,
      }}
    />
  );
}

function AnimatedBackground() {
  const shapes = useMemo(() => generateFloatingShapes(14), []);

  return (
    <div className={styles.canvasArea}>
      {/* Animated dot grid */}
      <div className={styles.dotGrid} />

      {/* Floating shapes */}
      <div className={styles.shapesLayer} aria-hidden="true">
        {shapes.map((s, i) => renderShape(s, i))}
      </div>
    </div>
  );
}

// ============================================================
// AuthGate Component
// ============================================================

/**
 * PRIMARY authentication boundary.
 *
 * Wraps the entire app and manages five states:
 *
 *   1. Demo      — demo mode active, bypasses Auth0 entirely
 *   2. Landing   — unauthenticated, shows login + demo buttons (no auto-redirects)
 *   3. Loading   — Auth0 SDK initializing or processing callback
 *   4. Error     — authentication failed, shows retry button
 *   5. Authenticated — renders children (the full app)
 *
 * SECURITY: This is the first gate. App.tsx has a secondary defensive check.
 *
 * URL PRESERVATION: loginWithRedirect saves the current pathname in
 * appState.returnTo so that after Auth0 callback, onRedirectCallback
 * in main.tsx navigates back to the original URL (e.g. /board/:boardId).
 */
export function AuthGate({ children }: AuthGateProps) {
  const { isLoading, isAuthenticated, error, loginWithRedirect } = useAuth0();
  const isDemoMode = useDemoStore((s) => s.isDemoMode);
  const enterDemoMode = useDemoStore((s) => s.enterDemoMode);

  const handleLogin = () => {
    loginWithRedirect({
      appState: { returnTo: window.location.pathname },
    });
  };

  // State 1: Demo mode active — bypass Auth0 entirely
  if (isDemoMode) {
    return <>{children}</>;
  }

  // State 2: SDK initializing or processing Auth0 callback (?code=&state=)
  if (isLoading) {
    return (
      <div className={styles.container}>
        <AnimatedBackground />
        <div className={styles.content}>
          <h1 className={styles.title}>NoteTime</h1>
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
        <AnimatedBackground />
        <div className={styles.content}>
          <h1 className={styles.title}>NoteTime</h1>
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

  // State 4: Not authenticated — show landing with login + demo buttons
  if (!isAuthenticated) {
    return (
      <div className={styles.container}>
        <AnimatedBackground />
        <div className={styles.content}>
          <h1 className={styles.title}>NoteTime</h1>
          <p className={styles.subtitle}>Real-time collaborative whiteboard</p>
          <button
            className={styles.loginButton}
            onClick={handleLogin}
          >
            Login with Auth0
          </button>
          <div className={styles.divider}>
            <span>or</span>
          </div>
          <button
            className={styles.demoButton}
            onClick={enterDemoMode}
          >
            Try Demo — No Account Needed
          </button>
        </div>
      </div>
    );
  }

  // State 5: Authenticated — render the full app
  return <>{children}</>;
}
