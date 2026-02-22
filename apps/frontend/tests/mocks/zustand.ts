/**
 * Zustand store reset utility for tests.
 * Import and call resetAllStores() in beforeEach to prevent state leakage.
 */
import { act } from '@testing-library/react';

// Store reset registry
const storeResetFns = new Set<() => void>();

export function registerStoreReset(resetFn: () => void) {
  storeResetFns.add(resetFn);
}

export async function resetAllStores() {
  await act(async () => {
    storeResetFns.forEach((fn) => fn());
  });
}
