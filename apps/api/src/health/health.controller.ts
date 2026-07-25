import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
}

@Controller('api/health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch (error: unknown) {
      // A health check that answers 200 while the database is unreachable is
      // worse than no health check at all — it tells every probe upstream that
      // this instance is fine to route traffic to.
      this.logger.error('Health check failed: database unreachable', error);
      throw new ServiceUnavailableException({
        status: 'degraded',
        database: 'down',
      } satisfies HealthResponse);
    }
  }
}
