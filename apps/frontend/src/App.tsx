import { useAuth0 } from '@auth0/auth0-react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Dashboard } from './components/dashboard/Dashboard';
import { BoardView } from './components/board/BoardView';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { useSocket } from './hooks/useSocket';
import { useDemoStore } from './stores/demoStore';
import styles from './App.module.css';

/**
 * Root application component with route definitions.
 *
 * SECURITY: This component has a SECONDARY authentication check
 * as defense-in-depth. The PRIMARY gate is AuthGate (in main.tsx).
 * AuthGate should catch 99.9% of unauthenticated access. This check
 * is a safety net for edge cases, bugs, or direct URL manipulation.
 *
 * DEMO MODE: When isDemoMode is true, the auth check is bypassed and
 * routes are restricted to the demo board only. No /admin access.
 *
 * SOCKET LIFECYCLE: useSocket() is called here (not in BoardView)
 * so the socket connection persists across route changes. Navigating
 * from /board/:id to / and back does not drop the WebSocket connection.
 * In demo mode, useSocket() returns a null socket and no-op functions.
 *
 * Routes:
 *   /                 -> Dashboard (board list + create)
 *   /board/:boardId   -> Board canvas view
 *   /admin            -> Admin metrics dashboard (blocked in demo)
 *   *                 -> Redirect to /
 */
export function App() {
  const { isAuthenticated, isLoading } = useAuth0();
  const isDemoMode = useDemoStore((s) => s.isDemoMode);
  const demoBoardId = useDemoStore((s) => s.demoBoardId);

  // Socket lifecycle lives here so it survives route changes.
  // The hook only creates a socket when isAuthenticated is true.
  // In demo mode, the hook returns a null socketRef and no-ops.
  const { socketRef, joinBoard, leaveBoard } = useSocket();

  const isTestMode = import.meta.env.VITE_TEST_MODE === 'true';

  // SECONDARY auth check — defense in depth
  // AuthGate is the primary boundary; this catches edge cases.
  // Demo mode and test mode bypass this check.
  if (!isLoading && !isAuthenticated && !isDemoMode && !isTestMode) {
    console.error('SECURITY: App rendered without authentication');
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingContent}>
          <h2 style={{ color: '#333', margin: 0 }}>Authentication Required</h2>
          <p>Please refresh the page and log in.</p>
        </div>
      </div>
    );
  }

  if (isLoading && !isDemoMode && !isTestMode) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingContent}>
          <div className={styles.spinner} />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route
        path="/board/:boardId"
        element={
          isDemoMode ? (
            <DemoBoardGuard
              demoBoardId={demoBoardId}
              socketRef={socketRef}
              joinBoard={joinBoard}
              leaveBoard={leaveBoard}
            />
          ) : (
            <BoardView
              socketRef={socketRef}
              joinBoard={joinBoard}
              leaveBoard={leaveBoard}
            />
          )
        }
      />
      {/* Admin dashboard blocked in demo mode */}
      <Route path="/admin" element={isDemoMode ? <Navigate to="/" replace /> : <AdminDashboard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// ────────────────────────────────────────────────────────
// Demo board route guard — only allows the demo board ID
// ────────────────────────────────────────────────────────

function DemoBoardGuard({
  demoBoardId,
  socketRef,
  joinBoard,
  leaveBoard,
}: {
  demoBoardId: string | null;
  socketRef: React.MutableRefObject<import('socket.io-client').Socket | null>;
  joinBoard: (boardId: string) => void;
  leaveBoard: (boardId: string) => void;
}) {
  const { boardId } = useParams<{ boardId: string }>();

  // If the URL boardId doesn't match the demo board, redirect to dashboard
  if (!demoBoardId || boardId !== demoBoardId) {
    return <Navigate to="/" replace />;
  }

  return (
    <BoardView
      socketRef={socketRef}
      joinBoard={joinBoard}
      leaveBoard={leaveBoard}
    />
  );
}
