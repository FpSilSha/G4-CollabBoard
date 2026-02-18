import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { Canvas } from './components/canvas/Canvas';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import styles from './App.module.css';

/**
 * Root application layout.
 *
 * +----------+-----------------------------+
 * |          |         Header              |
 * | Sidebar  +-----------------------------+
 * |          |                             |
 * |          |         Canvas              |
 * |          |                             |
 * +----------+-----------------------------+
 */
export function App() {
  // Register global keyboard shortcuts (V, S, R, C, I, Delete)
  useKeyboardShortcuts();

  return (
    <div className={styles.appLayout}>
      <Sidebar />
      <div className={styles.mainArea}>
        <Header />
        <Canvas />
      </div>
    </div>
  );
}
