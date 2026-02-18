import { useAuth0 } from '@auth0/auth0-react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Dashboard } from './components/dashboard/Dashboard';
import { BoardView } from './components/board/BoardView';
import { useSocket } from './hooks/useSocket';
import styles from './App.module.css';

/**
 * Root application component with route definitions.
 *
 * SECURITY: This component has a SECONDARY authentication check
 * as defense-in-depth. The PRIMARY gate is AuthGate (in main.tsx).
 * AuthGate should catch 99.9% of unauthenticated access. This check
 * is a safety net for edge cases, bugs, or direct URL manipulation.
 *
 * SOCKET LIFECYCLE: useSocket() is called here (not in BoardView)
 * so the socket connection persists across route changes. Navigating
 * from /board/:id to / and back does not drop the WebSocket connection.
 *
 * Routes:
 *   /                 -> Dashboard (board list + create)
 *   /board/:boardId   -> Board canvas view
 *   *                 -> Redirect to /
 */
export function App() {
  const { isAuthenticated, isLoading } = useAuth0();

  // Socket lifecycle lives here so it survives route changes.
  // The hook only creates a socket when isAuthenticated is true.
  const { socketRef, joinBoard, leaveBoard } = useSocket();

  // SECONDARY auth check — defense in depth
  // AuthGate is the primary boundary; this catches edge cases
  if (!isLoading && !isAuthenticated) {
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

  if (isLoading) {
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
          <BoardView
            socketRef={socketRef}
            joinBoard={joinBoard}
            leaveBoard={leaveBoard}
          />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
