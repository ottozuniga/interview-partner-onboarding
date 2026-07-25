import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

export interface TestEnv {
  databaseUrl: string;
}

/**
 * Reads apps/api/.env and returns the database the test suite is allowed to
 * touch. Refuses to run against anything that is not clearly a test database —
 * the suite truncates tables and resets the schema, so pointing it at the dev
 * database would be quietly destructive.
 */
export function resolveTestEnv(): TestEnv {
  loadDotenv({ path: resolve(__dirname, '..', '.env'), quiet: true });

  const databaseUrl = process.env.TEST_DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env and point it at a dedicated test database.',
    );
  }

  if (databaseUrl === process.env.DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL must differ from DATABASE_URL. The test suite resets the schema it connects to.',
    );
  }

  if (!/test/i.test(databaseUrl)) {
    throw new Error(
      `Refusing to run tests against "${databaseUrl}": the database name must contain "test".`,
    );
  }

  return { databaseUrl };
}
