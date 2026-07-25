import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  close(): Promise<void>;
}

/**
 * Boots a real Nest application against the real test database.
 *
 * Deliberately does NOT touch the data. Call `resetDatabase` between tests.
 * Keeping the two separate is what lets a test boot a *second* app against the
 * same database to simulate a server restart and assert that state survives.
 */
export async function createTestApp(
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<TestApp> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (customize) {
    builder = customize(builder);
  }

  const moduleRef = await builder.compile();

  // Silent by default. Several tests deliberately provoke failures and assert
  // the response, so their stack traces would otherwise read as suite failures
  // to anyone running `pnpm test`. Set TEST_LOGS=1 to get them back when
  // debugging.
  // The option has to be omitted entirely to keep the default logger; passing
  // `logger: undefined` is not the same as not passing it.
  const app =
    process.env.TEST_LOGS === '1'
      ? moduleRef.createNestApplication()
      : moduleRef.createNestApplication({ logger: false });
  await app.init();

  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    close: async () => {
      await app.close();
    },
  };
}

/**
 * Truncates everything and re-seeds the single hardcoded partner, returning
 * its id. Mirrors what `prisma db seed` does in development.
 */
export async function resetDatabase(prisma: PrismaService): Promise<string> {
  await prisma.truncateAllTables();

  const partner = await prisma.partner.create({
    data: { name: process.env.PARTNER_NAME ?? 'CompanyABC' },
  });

  return partner.id;
}
