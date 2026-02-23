/**
 * Playwright global teardown.
 *
 * Minimal cleanup — test data lives in collabboard_test DB
 * which gets truncated on next test run via global-setup.
 */
export default async function globalTeardown() {
  console.log('E2E test run complete.');
}
