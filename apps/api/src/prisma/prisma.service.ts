import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Wipes every table. Test-suite helper only — guarded so it can never run
   * against a database that is not obviously a test database.
   */
  async truncateAllTables(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('truncateAllTables() is only available when NODE_ENV=test');
    }

    await this.$executeRawUnsafe(
      'TRUNCATE TABLE "validation_attempts", "onboarding_sessions", "partners" RESTART IDENTITY CASCADE',
    );
  }
}
