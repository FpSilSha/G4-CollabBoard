// ARCHITECTURE NOTE: This uses a module-level ref intentionally.
// See JSDoc below for rationale. This pattern is NOT a Zustand store
// because the stored value is non-serializable (Socket.io / Fabric.js object).

/**
 * Module-scoped ref for the current sticky-note edit session.
 *
 * Bridges the imperative Fabric world (useObjectCreation hook) and the
 * React world (StickyEditModal component).  Fabric objects are NOT stored
 * in Zustand because they are mutable and non-serialisable.
 *
 * Lifecycle:
 *   double-click sticky  → setEditSession(session)   (hook writes)
 *   modal onChange        → getEditSession()          (modal reads & mutates)
 *   confirm / cancel      → setEditSession(null)      (hook clears)
 */

import type { fabric } from 'fabric';

export interface EditSession {
  /** The sticky-note Group being edited */
  target: fabric.Group;
  /** The Text child inside the Group (index 2) */
  textChild: fabric.Text;
  /** The Fabric canvas instance (for requestRenderAll) */
  canvas: fabric.Canvas;
  /** Throttled text broadcast (150 ms) */
  throttledEmit: ((text: string) => void) & { cancel: () => void };
  /** Unthrottled text broadcast (Final State Rule) */
  emitDirect: (text: string) => void;
}

let currentSession: EditSession | null = null;

export function setEditSession(session: EditSession | null): void {
  currentSession = session;
}

export function getEditSession(): EditSession | null {
  return currentSession;
}
