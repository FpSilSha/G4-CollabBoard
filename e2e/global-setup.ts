import { execSync } from 'child_process';
import path from 'path';

/**
 * Playwright global setup.
 *
 * 1. Verifies Docker is running (Postgres + Redis)
 * 2. Creates the collabboard_test database if it doesn't exist
 * 3. Runs Prisma migrations against the test database
 * 4. Truncates all tables for a clean slate
 */

/**
 * Find a running Docker container by partial name match.
 * Returns the full container name or null.
 */
function findContainer(partialName: string): string | null {
  try {
    const result = execSync(
      `docker ps --format "{{.Names}}" --filter "name=${partialName}"`,
      { stdio: 'pipe', timeout: 5000 }
    ).toString().trim();
    // Take the first match
    const names = result.split('\n').filter(Boolean);
    return names.length > 0 ? names[0] : null;
  } catch {
    return null;
  }
}

export default async function globalSetup() {
  const backendDir = path.resolve(__dirname, '../apps/backend');
  const testDbUrl = 'postgresql://collabboard:collabboard_dev@localhost:5432/collabboard_test';

  // 1. Find Docker containers (names vary by docker-compose version)
  const pgContainer = findContainer('postgres');
  const redisContainer = findContainer('redis');

  if (!pgContainer) {
    throw new Error(
      'Docker PostgreSQL container not found. Start it with: docker-compose up -d'
    );
  }

  if (!redisContainer) {
    throw new Error(
      'Docker Redis container not found. Start it with: docker-compose up -d'
    );
  }

  // Verify Postgres is ready
  try {
    execSync(`docker exec ${pgContainer} pg_isready -U collabboard`, {
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch {
    throw new Error(
      `Docker PostgreSQL (${pgContainer}) is not ready. Wait for it or restart with: docker-compose up -d`
    );
  }

  // Verify Redis is ready
  try {
    execSync(`docker exec ${redisContainer} redis-cli ping`, {
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch {
    throw new Error(
      `Docker Redis (${redisContainer}) is not ready. Wait for it or restart with: docker-compose up -d`
    );
  }

  console.log(`Using containers: postgres=${pgContainer}, redis=${redisContainer}`);

  // 2. Create test database if it doesn't exist
  try {
    execSync(
      `docker exec ${pgContainer} psql -U collabboard -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'collabboard_test'" | grep -q 1 || docker exec ${pgContainer} psql -U collabboard -d postgres -c "CREATE DATABASE collabboard_test"`,
      { stdio: 'pipe', timeout: 10000 }
    );
  } catch {
    // Database might already exist — that's fine
    console.log('Test database already exists or was just created.');
  }

  // 3. Run Prisma migrations against test database
  try {
    execSync('npx prisma migrate deploy', {
      cwd: backendDir,
      stdio: 'pipe',
      timeout: 30000,
      env: { ...process.env, DATABASE_URL: testDbUrl },
    });
    console.log('Prisma migrations applied to collabboard_test.');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to run Prisma migrations on test DB: ${message}`);
  }

  // 4. Truncate all tables for clean state
  try {
    execSync('npx prisma db execute --stdin', {
      cwd: backendDir,
      input: `TRUNCATE "User", "Board", "BoardVersion", "Subscription", "TeleportFlag", "LinkedBoard", "AuditLog" CASCADE;`,
      stdio: 'pipe',
      timeout: 10000,
      env: { ...process.env, DATABASE_URL: testDbUrl },
    });
    console.log('All tables truncated in collabboard_test.');
  } catch {
    // If tables don't exist yet that's fine — migrations will create them
    console.log('Table truncation skipped (tables may not exist yet).');
  }

  // 5. Flush test Redis keys
  try {
    execSync(`docker exec ${redisContainer} redis-cli FLUSHDB`, {
      stdio: 'pipe',
      timeout: 5000,
    });
    console.log('Redis flushed for test run.');
  } catch {
    console.log('Redis flush skipped.');
  }
}
