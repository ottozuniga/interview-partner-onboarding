import { resolveTestEnv } from './resolve-test-env';

/**
 * Runs before every test file, ahead of any Prisma import. Swaps DATABASE_URL
 * for TEST_DATABASE_URL so a stray test can never point at the dev database.
 */
const { databaseUrl } = resolveTestEnv();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = databaseUrl;
