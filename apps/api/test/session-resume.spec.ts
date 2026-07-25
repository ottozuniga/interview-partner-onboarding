import type { SessionView } from '@onboarding/contracts';
import request from 'supertest';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app';

const DETAILS = {
  companyName: 'CompanyABC',
  accountId: 'acct_valid',
  apiKey: 'sk_live_9876543210',
};

describe('Session resume', () => {
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

  const get = () => request(ctx.app.getHttpServer()).get('/api/onboarding/session');
  const putDetails = (body: object) =>
    request(ctx.app.getHttpServer()).put('/api/onboarding/session/details').send(body);

  describe('GET /api/onboarding/session', () => {
    it('creates an empty session on first visit', async () => {
      const { body } = await get().expect(200);
      const view = body as SessionView;

      expect(view.step).toBe('DETAILS');
      expect(view.status).toBe('IN_PROGRESS');
      expect(view.companyName).toBeNull();
      expect(view.hasApiKey).toBe(false);
      expect(view.canGoLive).toBe(false);
    });

    it('returns the same session on a second visit rather than starting over', async () => {
      const first = (await get().expect(200)).body as SessionView;
      const second = (await get().expect(200)).body as SessionView;

      expect(second.sessionId).toBe(first.sessionId);
      await expect(ctx.prisma.onboardingSession.count()).resolves.toBe(1);
    });

    // Deterministic proof that the guarantee lives in Postgres rather than in
    // application code: the concurrency test below relies on this rejection
    // happening, but cannot force the race to occur on every run.
    it('is refused a second open session by the database', async () => {
      const view = (await get().expect(200)).body as SessionView;
      const { partnerId } = await ctx.prisma.onboardingSession.findFirstOrThrow({
        where: { id: view.sessionId },
      });

      await expect(ctx.prisma.onboardingSession.create({ data: { partnerId } })).rejects.toMatchObject(
        { code: 'P2002' },
      );
    });

    // The partial unique index has to hold here: two simultaneous first visits
    // must not race into two open sessions, which would make "resume" ambiguous.
    it('creates exactly one session under concurrent first visits', async () => {
      const responses = await Promise.all([get(), get(), get(), get()]);

      for (const response of responses) {
        expect(response.status).toBe(200);
      }

      const ids = new Set(responses.map((r) => (r.body as SessionView).sessionId));
      expect(ids.size).toBe(1);
      await expect(ctx.prisma.onboardingSession.count()).resolves.toBe(1);
    });
  });

  describe('PUT /api/onboarding/session/details', () => {
    it('saves details and advances the partner to the validate step', async () => {
      const view = (await putDetails(DETAILS).expect(200)).body as SessionView;

      expect(view.step).toBe('VALIDATE');
      expect(view.companyName).toBe(DETAILS.companyName);
      expect(view.providerAccountId).toBe(DETAILS.accountId);
      expect(view.hasApiKey).toBe(true);
    });

    it('never returns the raw api key', async () => {
      const response = await putDetails(DETAILS).expect(200);

      expect(JSON.stringify(response.body)).not.toContain(DETAILS.apiKey);
      expect((response.body as SessionView).apiKeyMasked).toBe('••••3210');
    });

    it('stores the api key so the partner does not have to retype it', async () => {
      await putDetails(DETAILS).expect(200);

      const stored = await ctx.prisma.onboardingSession.findFirstOrThrow();
      expect(stored.providerApiKey).toBe(DETAILS.apiKey);
      expect(stored.credentialsFingerprint).toHaveLength(64);
    });

    it('rewrites the fingerprint when credentials change', async () => {
      await putDetails(DETAILS).expect(200);
      const before = await ctx.prisma.onboardingSession.findFirstOrThrow();

      await putDetails({ ...DETAILS, apiKey: 'sk_live_different' }).expect(200);
      const after = await ctx.prisma.onboardingSession.findFirstOrThrow();

      expect(after.id).toBe(before.id);
      expect(after.credentialsFingerprint).not.toBe(before.credentialsFingerprint);
    });

    it('leaves the fingerprint alone when the same credentials are resubmitted', async () => {
      await putDetails(DETAILS).expect(200);
      const before = await ctx.prisma.onboardingSession.findFirstOrThrow();

      await putDetails({ ...DETAILS, companyName: 'CompanyABC Ltd' }).expect(200);
      const after = await ctx.prisma.onboardingSession.findFirstOrThrow();

      expect(after.credentialsFingerprint).toBe(before.credentialsFingerprint);
      expect(after.companyName).toBe('CompanyABC Ltd');
    });

    it.each([
      ['missing company name', { ...DETAILS, companyName: '' }],
      ['missing account id', { ...DETAILS, accountId: '   ' }],
      ['missing api key on a session that has none', { companyName: 'CompanyABC', accountId: 'acct' }],
      ['an empty api key', { ...DETAILS, apiKey: '' }],
      ['wrong types', { companyName: 42, accountId: true, apiKey: null }],
    ])('rejects %s with 400', async (_label, body) => {
      await putDetails(body).expect(400);
    });

    // The key never comes back from the server, so the form cannot resubmit
    // it. Omitting it must mean "keep the stored one" rather than "clear it".
    it('keeps the stored api key when the field is omitted', async () => {
      await putDetails(DETAILS).expect(200);

      const view = (
        await putDetails({ companyName: 'CompanyABC Ltd', accountId: DETAILS.accountId }).expect(
          200,
        )
      ).body as SessionView;

      expect(view.companyName).toBe('CompanyABC Ltd');
      expect(view.hasApiKey).toBe(true);

      const stored = await ctx.prisma.onboardingSession.findFirstOrThrow();
      expect(stored.providerApiKey).toBe(DETAILS.apiKey);
    });

    it('re-fingerprints against the stored key when only the account id changes', async () => {
      await putDetails(DETAILS).expect(200);
      const before = await ctx.prisma.onboardingSession.findFirstOrThrow();

      await putDetails({ companyName: DETAILS.companyName, accountId: 'acct_partial' }).expect(200);
      const after = await ctx.prisma.onboardingSession.findFirstOrThrow();

      expect(after.providerApiKey).toBe(DETAILS.apiKey);
      expect(after.credentialsFingerprint).not.toBe(before.credentialsFingerprint);
    });

    it('does not persist anything when the payload is rejected', async () => {
      await putDetails({ companyName: '' }).expect(400);

      const sessions = await ctx.prisma.onboardingSession.findMany();
      expect(sessions.every((s) => s.companyName === null)).toBe(true);
    });
  });

  describe('resume', () => {
    it('returns prior input on a fresh read, as a reload or incognito window would', async () => {
      const saved = (await putDetails(DETAILS).expect(200)).body as SessionView;
      const resumed = (await get().expect(200)).body as SessionView;

      expect(resumed).toEqual(saved);
    });

    // The real test of "state lives on the server": a brand new application
    // instance, sharing nothing but the database, must resume identically.
    it('survives a server restart', async () => {
      const before = (await putDetails(DETAILS).expect(200)).body as SessionView;

      const restarted = await createTestApp();
      try {
        const after = (
          await request(restarted.app.getHttpServer()).get('/api/onboarding/session').expect(200)
        ).body as SessionView;

        expect(after).toEqual(before);
        expect(after.step).toBe('VALIDATE');
        expect(after.companyName).toBe(DETAILS.companyName);
      } finally {
        await restarted.close();
      }
    });
  });
});
