import { resolveTestEnv } from './resolve-test-env';

/**
 * Runs before every test file, ahead of any Prisma import. Swaps DATABASE_URL
 * for TEST_DATABASE_URL so a stray test can never point at the dev database.
 */
const { databaseUrl } = resolveTestEnv();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = databaseUrl;

// Timing knobs are compressed so the suite exercises real timeout and
// stale-attempt behaviour in milliseconds rather than seconds. The developer
// defaults in .env are tuned for watching the UI, not for tests.
process.env.PROVIDER_LATENCY_MS = '0';
process.env.PROVIDER_TIMEOUT_MS = '300';
process.env.ATTEMPT_STALE_GRACE_MS = '200';
