import type { SessionView, ValidateResponse } from '@onboarding/contracts';
import request from 'supertest';
import {
  PROVIDER_CLIENT,
  type ProviderClient,
} from '../src/provider-mock/provider-client';
import { MockProviderService } from '../src/provider-mock/mock-provider.service';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app';
import { sleep, waitForSettledAttempt } from './helpers/wait';

const API_KEY = 'sk_live_9876543210';
const details = (accountId: string) => ({
  companyName: 'CompanyABC',
  accountId,
  apiKey: API_KEY,
});

describe('Provider validation', () => {
  let ctx: TestApp;
  let providerSpy: jest.SpyInstance;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.app.get(MockProviderService).resetTransientState();

    const client = ctx.app.get<ProviderClient>(PROVIDER_CLIENT);
    providerSpy = jest.spyOn(client, 'validate');
  });

  const getSession = () => request(ctx.app.getHttpServer()).get('/api/onboarding/session');
  const putDetails = (body: object) =>
    request(ctx.app.getHttpServer()).put('/api/onboarding/session/details').send(body);
  const postValidate = (body: object = {}) =>
    request(ctx.app.getHttpServer()).post('/api/onboarding/session/validate').send(body);
  /** A deliberate "check these credentials again", as opposed to a stray click. */
  const postRevalidate = () => postValidate({ revalidate: true });

  async function validate(accountId: string): Promise<SessionView> {
    await putDetails(details(accountId)).expect(200);
    await postValidate().expect(202);
    return waitForSettledAttempt(getSession);
  }

  describe('provider outcomes', () => {
    it('records a valid result and lets the partner advance to review', async () => {
      const view = await validate('acct_valid');

      expect(view.latestAttempt?.status).toBe('VALID');
      expect(view.step).toBe('REVIEW');
      expect(view.canGoLive).toBe(true);
      expect(view.requiresWarningAck).toBe(false);
      expect(view.effectiveValidation?.items.length).toBeGreaterThan(0);
    });

    it('surfaces warnings on a partial result but still allows the partner to decide', async () => {
      const view = await validate('acct_partial');

      expect(view.latestAttempt?.status).toBe('PARTIAL');
      expect(view.step).toBe('REVIEW');
      expect(view.canGoLive).toBe(true);
      expect(view.requiresWarningAck).toBe(true);
      expect(view.effectiveValidation?.warnings.length).toBeGreaterThan(0);
    });

    it('reports a reason and holds on validate when credentials are rejected', async () => {
      const view = await validate('acct_invalid');

      expect(view.latestAttempt?.status).toBe('INVALID');
      expect(view.latestAttempt?.reason).toBeTruthy();
      expect(view.step).toBe('VALIDATE');
      expect(view.canGoLive).toBe(false);
      expect(view.effectiveValidation).toBeNull();
    });

    it('treats a 503 as transient rather than a rejection', async () => {
      const view = await validate('acct_unavailable');

      expect(view.latestAttempt?.status).toBe('TRANSIENT_FAILURE');
      expect(view.step).toBe('VALIDATE');
      expect(view.effectiveValidation).toBeNull();
    });

    it('treats a provider that never responds as transient', async () => {
      const view = await validate('acct_timeout');

      expect(view.latestAttempt?.status).toBe('TRANSIENT_FAILURE');
      expect(view.latestAttempt?.reason).toMatch(/timed out/i);
    });

    it('succeeds on retry after a transient failure', async () => {
      const failed = await validate('acct_flaky');
      expect(failed.latestAttempt?.status).toBe('TRANSIENT_FAILURE');

      await postValidate().expect(202);
      const retried = await waitForSettledAttempt(getSession);

      expect(retried.latestAttempt?.status).toBe('VALID');
      expect(retried.step).toBe('REVIEW');
    });
  });

  describe('idempotency', () => {
    it('rejects validation before credentials have been entered', async () => {
      await getSession().expect(200);
      await postValidate().expect(409);
      await expect(ctx.prisma.validationAttempt.count()).resolves.toBe(0);
    });

    // The headline requirement: double-clicking Validate must not fire two
    // Provider calls.
    it('fires exactly one provider call for concurrent validate requests', async () => {
      await putDetails(details('acct_valid')).expect(200);

      const responses = await Promise.all([
        postValidate(),
        postValidate(),
        postValidate(),
        postValidate(),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(202);
      }

      const bodies = responses.map((r) => r.body as ValidateResponse);
      expect(new Set(bodies.map((b) => b.attemptId)).size).toBe(1);
      expect(bodies.filter((b) => b.deduplicated)).toHaveLength(3);

      await waitForSettledAttempt(getSession);

      expect(providerSpy).toHaveBeenCalledTimes(1);
      await expect(ctx.prisma.validationAttempt.count()).resolves.toBe(1);
    });

    // Deterministic proof of the guarantee the test above depends on but
    // cannot force to race on every run.
    it('is refused a second running attempt by the database', async () => {
      await putDetails(details('acct_valid')).expect(200);
      const session = await ctx.prisma.onboardingSession.findFirstOrThrow();

      await ctx.prisma.validationAttempt.create({
        data: {
          sessionId: session.id,
          status: 'RUNNING',
          credentialsFingerprint: session.credentialsFingerprint ?? '',
        },
      });

      await expect(
        ctx.prisma.validationAttempt.create({
          data: {
            sessionId: session.id,
            status: 'RUNNING',
            credentialsFingerprint: session.credentialsFingerprint ?? '',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    // The complement of the concurrency test: once a result exists, clicking
    // Validate again must NOT call the Provider a second time, however quickly
    // it answered the first time.
    it('reuses an existing result instead of calling the provider again', async () => {
      await validate('acct_valid');

      const { body } = await postValidate().expect(202);
      expect((body as ValidateResponse).deduplicated).toBe(true);
      expect((body as ValidateResponse).status).toBe('VALID');

      expect(providerSpy).toHaveBeenCalledTimes(1);
      await expect(ctx.prisma.validationAttempt.count()).resolves.toBe(1);
    });

    it('calls the provider again when re-validation is explicitly requested', async () => {
      await validate('acct_valid');
      await postRevalidate().expect(202);
      await waitForSettledAttempt(getSession);

      expect(providerSpy).toHaveBeenCalledTimes(2);
      await expect(ctx.prisma.validationAttempt.count()).resolves.toBe(2);
    });

    it('retries after a transient failure without being asked twice', async () => {
      await validate('acct_unavailable');
      expect(providerSpy).toHaveBeenCalledTimes(1);

      // A transient failure is not an answer, so a plain Validate retries.
      await postValidate().expect(202);
      await waitForSettledAttempt(getSession);

      expect(providerSpy).toHaveBeenCalledTimes(2);
    });

    it('reuses a rejection rather than re-asking with unchanged credentials', async () => {
      await validate('acct_invalid');

      const { body } = await postValidate().expect(202);
      expect((body as ValidateResponse).deduplicated).toBe(true);
      expect((body as ValidateResponse).status).toBe('INVALID');
      expect(providerSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('state is never corrupted by a transient failure', () => {
    // The other headline requirement: a transient 503 must not corrupt state.
    it('keeps an earlier valid result and its items when a retry fails', async () => {
      const good = await validate('acct_valid');
      expect(good.step).toBe('REVIEW');

      // Force the next call to fail without touching the credentials, so the
      // fingerprint — and therefore the earlier result — still applies.
      providerSpy.mockRejectedValueOnce(new Error('boom'));
      await postRevalidate().expect(202);
      const afterFailure = await waitForSettledAttempt(getSession);

      expect(afterFailure.latestAttempt?.status).toBe('TRANSIENT_FAILURE');
      // Still reviewable, with the original items intact.
      expect(afterFailure.step).toBe('REVIEW');
      expect(afterFailure.canGoLive).toBe(true);
      expect(afterFailure.effectiveValidation?.attemptId).toBe(good.effectiveValidation?.attemptId);
      expect(afterFailure.effectiveValidation?.items).toEqual(good.effectiveValidation?.items);
    });

    it('leaves the session row untouched when the provider is unavailable', async () => {
      await putDetails(details('acct_unavailable')).expect(200);
      const before = await ctx.prisma.onboardingSession.findFirstOrThrow();

      await postValidate().expect(202);
      await waitForSettledAttempt(getSession);

      const after = await ctx.prisma.onboardingSession.findFirstOrThrow();
      expect(after).toEqual(before);
    });
  });

  describe('credential changes', () => {
    it('invalidates a prior valid result when credentials are edited', async () => {
      const validated = await validate('acct_valid');
      expect(validated.step).toBe('REVIEW');

      await putDetails({ ...details('acct_valid'), apiKey: 'sk_live_rotated' }).expect(200);
      const view = (await getSession().expect(200)).body as SessionView;

      expect(view.step).toBe('VALIDATE');
      expect(view.canGoLive).toBe(false);
      expect(view.effectiveValidation).toBeNull();
      expect(view.latestAttempt?.matchesCurrentCredentials).toBe(false);
    });
  });

  describe('abandoned attempts', () => {
    // Simulates the server being killed after inserting the attempt but before
    // writing its outcome: the row would otherwise stay RUNNING forever and
    // block every future validation via the unique index.
    it('reaps a stale running attempt on the next read and allows a retry', async () => {
      await putDetails(details('acct_valid')).expect(200);
      const session = await ctx.prisma.onboardingSession.findFirstOrThrow();

      await ctx.prisma.validationAttempt.create({
        data: {
          sessionId: session.id,
          status: 'RUNNING',
          credentialsFingerprint: session.credentialsFingerprint ?? '',
          startedAt: new Date(Date.now() - 60_000),
        },
      });

      const view = (await getSession().expect(200)).body as SessionView;
      expect(view.latestAttempt?.status).toBe('TRANSIENT_FAILURE');
      expect(view.step).toBe('VALIDATE');

      await postValidate().expect(202);
      const retried = await waitForSettledAttempt(getSession);
      expect(retried.latestAttempt?.status).toBe('VALID');
    });

    it('does not reap an attempt that is still within its deadline', async () => {
      await putDetails(details('acct_valid')).expect(200);
      const session = await ctx.prisma.onboardingSession.findFirstOrThrow();

      await ctx.prisma.validationAttempt.create({
        data: {
          sessionId: session.id,
          status: 'RUNNING',
          credentialsFingerprint: session.credentialsFingerprint ?? '',
        },
      });

      const view = (await getSession().expect(200)).body as SessionView;
      expect(view.latestAttempt?.status).toBe('RUNNING');
    });

    // A late reply from the Provider must not resurrect an attempt that has
    // already been written off, or the partner's view would flip back.
    it('discards a provider result that arrives after the attempt was reaped', async () => {
      await putDetails(details('acct_valid')).expect(200);

      // Resolve only after the attempt has aged past the stale threshold.
      providerSpy.mockImplementationOnce(async () => {
        await sleep(700);
        return { status: 'valid' as const, items: [] };
      });

      await postValidate().expect(202);
      await waitForSettledAttempt(getSession);

      const settled = (await getSession().expect(200)).body as SessionView;
      expect(settled.latestAttempt?.status).toBe('TRANSIENT_FAILURE');

      // Give the late call time to land and try to overwrite the outcome.
      await sleep(300);

      const final = (await getSession().expect(200)).body as SessionView;
      expect(final.latestAttempt?.status).toBe('TRANSIENT_FAILURE');
      await expect(ctx.prisma.validationAttempt.count()).resolves.toBe(1);
    });
  });
});
