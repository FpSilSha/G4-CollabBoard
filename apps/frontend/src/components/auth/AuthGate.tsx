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

// Floating shape colors — full palette
const SHAPE_COLORS = [
  '#FFEB3B', '#FF9800', '#F44336', '#E91E63', '#9C27B0',
  '#3F51B5', '#2196F3', '#00BCD4', '#4CAF50', '#8BC34A',
];

// Border pattern colors — pastels + earth tones only (no neon, no WCAG)
const BORDER_COLORS = [
  '#FFE082', '#A5D6A7', '#90CAF9', '#F48FB1', '#FFCC80', '#CE93D8', '#80DEEA', '#DCE775', // pastels
  '#D7CCC8', '#BCAAA4', '#A5D6A7', '#FFCC80', '#FFAB91', '#C5CAE9', '#F5F5DC', '#CFD8DC', // earth
];

type FlowDirection = 'BL' | 'TL'; // BL = bottom-left→top-right, TL = top-left→bottom-right

interface FloatingShapeDef {
  type: 'circle' | 'rect' | 'triangle' | 'sticky';
  size: number;
  color: string;
  startX: number;   // % from left — starting position
  startY: number;   // % from top  — starting position
  duration: number;  // seconds
  delay: number;     // seconds
  rotation: number;  // degrees
  opacity: number;
  flow: FlowDirection;
}

function generateFloatingShapes(count: number): FloatingShapeDef[] {
  // Seeded PRNG for deterministic shapes
  let seed = 7;
  const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; };

  const types: FloatingShapeDef['type'][] = ['circle', 'rect', 'triangle', 'sticky'];
  const shapes: FloatingShapeDef[] = [];

  for (let i = 0; i < count; i++) {
    // Alternate flows: even indices go BL→TR, odd go TL→BR
    const flow: FlowDirection = i % 2 === 0 ? 'BL' : 'TL';

    // Starting positions depend on flow direction
    let startX: number, startY: number;
    if (flow === 'BL') {
      // Start from bottom-left area
      startX = -15 + rand() * 40;
      startY = 70 + rand() * 45;
    } else {
      // Start from top-left area
      startX = -15 + rand() * 40;
      startY = -15 + rand() * 40;
    }

    shapes.push({
      type: types[Math.floor(rand() * types.length)],
      size: 25 + rand() * 45,
      color: SHAPE_COLORS[Math.floor(rand() * SHAPE_COLORS.length)],
      startX,
      startY,
      duration: 14 + rand() * 18,
      delay: rand() * 20,
      rotation: Math.floor(rand() * 360),
      opacity: 0.25 + rand() * 0.25,
      flow,
    });
  }
  return shapes;
}

function renderShape(s: FloatingShapeDef, i: number) {
  const flowClass = s.flow === 'BL' ? styles.floatBL : styles.floatTL;
  const cls = `${styles.floatingShape} ${flowClass}`;
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
        className={cls}
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
        className={cls}
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
        className={cls}
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
      className={cls}
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

// ============================================================
// Border Pattern — repeating shapes along all 4 edges
// ============================================================

// Shape sequence: square(+tilt), circle, diamond, triangle, square(-tilt), circle, ...
type BorderShapeType = 'sqPos' | 'circle' | 'diamond' | 'triangle' | 'sqNeg';
const BORDER_SEQUENCE: BorderShapeType[] = ['sqPos', 'circle', 'diamond', 'triangle', 'sqNeg', 'circle'];

interface BorderShapeDef {
  type: BorderShapeType;
  x: number;
  y: number;
  color: string;
  size: number;
}

function generateBorderShapes(): BorderShapeDef[] {
  let seed = 99;
  const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; };

  const shapes: BorderShapeDef[] = [];
  const size = 22;
  const spacing = 48;     // px between shape centers
  const edgeInset = 14;   // px from edge

  // We'll place shapes in a virtual pixel grid then convert to %
  // Canvas area is 85vw × 80vh, max 1200×800. Use 1200×800 as reference.
  const W = 1200;
  const H = 800;

  let seqIdx = 0;
  const addShape = (x: number, y: number) => {
    shapes.push({
      type: BORDER_SEQUENCE[seqIdx % BORDER_SEQUENCE.length],
      x: (x / W) * 100,
      y: (y / H) * 100,
      color: BORDER_COLORS[Math.floor(rand() * BORDER_COLORS.length)],
      size,
    });
    seqIdx++;
  };

  // Top edge (left to right)
  for (let x = spacing; x < W - spacing; x += spacing) addShape(x, edgeInset);
  // Right edge (top to bottom)
  for (let y = spacing; y < H - spacing; y += spacing) addShape(W - edgeInset, y);
  // Bottom edge (right to left)
  for (let x = W - spacing; x > spacing; x -= spacing) addShape(x, H - edgeInset);
  // Left edge (bottom to top)
  for (let y = H - spacing; y > spacing; y -= spacing) addShape(edgeInset, y);

  return shapes;
}

function renderBorderShape(s: BorderShapeDef, i: number) {
  const base: React.CSSProperties = {
    position: 'absolute',
    left: `${s.x}%`,
    top: `${s.y}%`,
    transform: 'translate(-50%, -50%)',
    opacity: 0.45,
  };

  switch (s.type) {
    case 'sqPos':
      return (
        <div key={`b${i}`} style={{
          ...base, width: s.size, height: s.size,
          background: s.color, borderRadius: 3,
          transform: 'translate(-50%, -50%) rotate(10deg)',
        }} />
      );
    case 'sqNeg':
      return (
        <div key={`b${i}`} style={{
          ...base, width: s.size, height: s.size,
          background: s.color, borderRadius: 3,
          transform: 'translate(-50%, -50%) rotate(-10deg)',
        }} />
      );
    case 'circle':
      return (
        <div key={`b${i}`} style={{
          ...base, width: s.size, height: s.size,
          background: s.color, borderRadius: '50%',
        }} />
      );
    case 'diamond':
      return (
        <div key={`b${i}`} style={{
          ...base, width: s.size * 0.8, height: s.size * 0.8,
          background: s.color, borderRadius: 3,
          transform: 'translate(-50%, -50%) rotate(45deg)',
        }} />
      );
    case 'triangle': {
      const half = s.size / 2;
      return (
        <div key={`b${i}`} style={{
          ...base, width: 0, height: 0,
          background: 'transparent',
          borderLeft: `${half}px solid transparent`,
          borderRight: `${half}px solid transparent`,
          borderBottom: `${s.size}px solid ${s.color}`,
        }} />
      );
    }
  }
}

// ============================================================
// Combined Animated Background
// ============================================================

function AnimatedBackground() {
  const shapes = useMemo(() => generateFloatingShapes(14), []);
  const borderShapes = useMemo(() => generateBorderShapes(), []);

  return (
    <div className={styles.canvasArea}>
      {/* Animated dot grid */}
      <div className={styles.dotGrid} />

      {/* Border pattern — stationary shapes along edges */}
      <div className={styles.borderLayer} aria-hidden="true">
        {borderShapes.map((s, i) => renderBorderShape(s, i))}
      </div>

      {/* Floating shapes — animated across the canvas */}
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

  // State 0: E2E test mode — bypass Auth0 entirely
  if (import.meta.env.VITE_TEST_MODE === 'true') {
    return <>{children}</>;
  }

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
