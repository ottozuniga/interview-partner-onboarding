import type { SessionView } from '@onboarding/contracts';
import request from 'supertest';
import { MockProviderService } from '../src/provider-mock/mock-provider.service';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app';
import { waitForSettledAttempt } from './helpers/wait';

const details = (accountId: string) => ({
  companyName: 'CompanyABC',
  accountId,
  apiKey: 'sk_live_9876543210',
});

describe('Go live', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.app.get(MockProviderService).resetTransientState();
  });

  const getSession = () => request(ctx.app.getHttpServer()).get('/api/onboarding/session');
  const putDetails = (body: object) =>
    request(ctx.app.getHttpServer()).put('/api/onboarding/session/details').send(body);
  const postValidate = (body: object = {}) =>
    request(ctx.app.getHttpServer()).post('/api/onboarding/session/validate').send(body);
  const postComplete = (body: object = {}) =>
    request(ctx.app.getHttpServer()).post('/api/onboarding/session/complete').send(body);

  /** Walks the wizard up to the review step. */
  async function reachReview(accountId: string): Promise<SessionView> {
    await putDetails(details(accountId)).expect(200);
    await postValidate().expect(202);
    return waitForSettledAttempt(getSession);
  }

  const partner = () => ctx.prisma.partner.findFirstOrThrow();
  const session = () => ctx.prisma.onboardingSession.findFirstOrThrow();

  describe('happy path', () => {
    it('completes the session and marks the partner live', async () => {
      await reachReview('acct_valid');

      const view = (await postComplete().expect(200)).body as SessionView;

      expect(view.status).toBe('COMPLETED');
      expect(view.step).toBe('LIVE');
      expect(view.completedAt).not.toBeNull();
      expect(view.canGoLive).toBe(false);

      await expect(partner()).resolves.toMatchObject({ isLive: true });
      await expect(session()).resolves.toMatchObject({ status: 'COMPLETED' });
    });

    it('keeps showing the live state on reload rather than restarting the wizard', async () => {
      await reachReview('acct_valid');
      await postComplete().expect(200);

      const resumed = (await getSession().expect(200)).body as SessionView;

      expect(resumed.step).toBe('LIVE');
      expect(resumed.status).toBe('COMPLETED');
      await expect(ctx.prisma.onboardingSession.count()).resolves.toBe(1);
    });
  });

  describe('preconditions', () => {
    it('refuses to go live before anything has been validated', async () => {
      await putDetails(details('acct_valid')).expect(200);

      await postComplete().expect(409);

      await expect(partner()).resolves.toMatchObject({ isLive: false });
      await expect(session()).resolves.toMatchObject({ status: 'IN_PROGRESS' });
    });

    it('refuses to go live when the provider rejected the credentials', async () => {
      await reachReview('acct_invalid');

      await postComplete().expect(409);

      await expect(partner()).resolves.toMatchObject({ isLive: false });
    });

    it('refuses to go live on a transient failure alone', async () => {
      await reachReview('acct_unavailable');

      await postComplete().expect(409);

      await expect(partner()).resolves.toMatchObject({ isLive: false });
    });

    // The client could have been left on the review step in another tab.
    it('refuses to go live on a result that predates a credential change', async () => {
      await reachReview('acct_valid');
      await putDetails({ ...details('acct_valid'), apiKey: 'sk_live_rotated' }).expect(200);

      await postComplete().expect(409);

      await expect(partner()).resolves.toMatchObject({ isLive: false });
    });
  });

  describe('partial results', () => {
    it('refuses to go live on a partial result until the warnings are acknowledged', async () => {
      const review = await reachReview('acct_partial');
      expect(review.requiresWarningAck).toBe(true);

      await postComplete().expect(400);
      await postComplete({ acknowledgedWarnings: false }).expect(400);

      await expect(partner()).resolves.toMatchObject({ isLive: false });
    });

    it('goes live on a partial result once the warnings are acknowledged', async () => {
      await reachReview('acct_partial');

      const view = (await postComplete({ acknowledgedWarnings: true }).expect(200))
        .body as SessionView;

      expect(view.step).toBe('LIVE');
      await expect(partner()).resolves.toMatchObject({ isLive: true });
    });
  });

  describe('consistency', () => {
    // All-or-nothing: a failure after the session has been marked complete but
    // before the partner is live must leave neither change behind.
    it('rolls back completely when something fails midway', async () => {
      await reachReview('acct_valid');

      const realTransaction = ctx.prisma.$transaction.bind(ctx.prisma);
      jest
        .spyOn(ctx.prisma, '$transaction')
        .mockImplementationOnce(((body: (tx: unknown) => Promise<unknown>) =>
          realTransaction(async (tx: unknown) => {
            await body(tx);
            // Everything the go-live did is now staged but uncommitted.
            throw new Error('injected failure before commit');
          })) as never);

      // 503, not 500: nothing was committed, so retrying is safe — and the
      // partner is told so rather than being left wondering whether they are
      // half-live.
      const response = await postComplete().expect(503);
      expect(response.body.message).toMatch(/safe to try again/i);

      await expect(session()).resolves.toMatchObject({
        status: 'IN_PROGRESS',
        completedAt: null,
        version: 0,
      });
      await expect(partner()).resolves.toMatchObject({ isLive: false, liveAt: null });

      // And the retry genuinely succeeds, rather than the claim being cosmetic.
      const retried = (await postComplete().expect(200)).body as SessionView;
      expect(retried.step).toBe('LIVE');
      await expect(partner()).resolves.toMatchObject({ isLive: true });
    });

    it('transitions once when two go-live requests arrive together', async () => {
      await reachReview('acct_valid');

      const responses = await Promise.all([postComplete(), postComplete(), postComplete()]);

      for (const response of responses) {
        expect(response.status).toBe(200);
        expect((response.body as SessionView).step).toBe('LIVE');
      }

      const completed = await session();
      expect(completed.status).toBe('COMPLETED');
      // One and only one transition took place.
      expect(completed.version).toBe(1);
      await expect(partner()).resolves.toMatchObject({ isLive: true });
      await expect(ctx.prisma.onboardingSession.count()).resolves.toBe(1);
    });

    it('is idempotent when submitted again', async () => {
      await reachReview('acct_valid');
      const first = (await postComplete().expect(200)).body as SessionView;
      const second = (await postComplete().expect(200)).body as SessionView;

      expect(second.sessionId).toBe(first.sessionId);
      expect(second.completedAt).toBe(first.completedAt);
      await expect(session()).resolves.toMatchObject({ version: 1 });
    });
  });

  describe('reset', () => {
    const postReset = () => request(ctx.app.getHttpServer()).post('/api/onboarding/session/reset');

    it('starts a fresh session after going live', async () => {
      await reachReview('acct_valid');
      await postComplete().expect(200);

      const view = (await postReset().expect(200)).body as SessionView;

      expect(view.step).toBe('DETAILS');
      expect(view.status).toBe('IN_PROGRESS');
      expect(view.companyName).toBeNull();
      expect(view.hasApiKey).toBe(false);
      await expect(partner()).resolves.toMatchObject({ isLive: false, liveAt: null });
    });

    it('abandons an in-progress session without deleting the history', async () => {
      await reachReview('acct_valid');

      await postReset().expect(200);

      const abandoned = await ctx.prisma.onboardingSession.findMany({
        where: { status: 'ABANDONED' },
      });
      expect(abandoned).toHaveLength(1);
      // The attempt is retained alongside it rather than cascaded away.
      await expect(ctx.prisma.validationAttempt.count()).resolves.toBe(1);
    });

    it('is harmless when there is nothing to reset', async () => {
      const view = (await postReset().expect(200)).body as SessionView;
      expect(view.step).toBe('DETAILS');
    });
  });

  describe('a live session is closed to further edits', () => {
    beforeEach(async () => {
      await reachReview('acct_valid');
      await postComplete().expect(200);
    });

    it('rejects changes to the details', async () => {
      await putDetails(details('acct_valid')).expect(409);
    });

    it('rejects further validation', async () => {
      await postValidate().expect(409);
      await postValidate({ revalidate: true }).expect(409);
    });
  });
});
