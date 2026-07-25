import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resolveTestEnv } from './resolve-test-env';

/**
 * Runs once before the suite, bringing the test database up to date from the
 * real migration files — not `prisma db push` — so the hand-written partial
 * unique indexes the concurrency tests depend on are actually present.
 *
 * `migrate deploy` rather than `migrate reset`: applying pending migrations is
 * idempotent and non-destructive, and per-test truncation already gives each
 * test a clean slate. Nothing in the normal test loop needs to drop a database.
 * If the test schema ever drifts, run `pnpm db:reset` explicitly.
 */
export default function globalSetup(): void {
  const { databaseUrl } = resolveTestEnv();
  const apiRoot = resolve(__dirname, '..');

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}
