import request from 'supertest';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app';

describe('GET /api/health', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
  });

  it('reports the database as reachable', async () => {
    const response = await request(ctx.app.getHttpServer()).get('/api/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('has the partial unique indexes the concurrency guarantees depend on', async () => {
    const indexes = await ctx.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('one_open_session_per_partner', 'one_running_attempt_per_session')
    `;

    expect(indexes.map((i) => i.indexname).sort()).toEqual([
      'one_open_session_per_partner',
      'one_running_attempt_per_session',
    ]);
  });
});
