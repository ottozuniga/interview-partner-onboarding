import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],

  // Points DATABASE_URL at the test database before anything imports Prisma.
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  // Resets and migrates that database once, before the suite.
  globalSetup: '<rootDir>/test/global-setup.ts',

  // Tests share one Postgres database and truncate between cases, so they
  // must not run concurrently. `pnpm test` also passes --runInBand.
  maxWorkers: 1,

  testTimeout: 30_000,
  clearMocks: true,
};

export default config;
