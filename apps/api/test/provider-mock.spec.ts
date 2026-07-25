import { providerValidateResponseSchema } from '@onboarding/contracts';
import request from 'supertest';
import { MockProviderService } from '../src/provider-mock/mock-provider.service';
import { createTestApp, type TestApp } from './helpers/test-app';

/**
 * The Provider's published contract. These assertions are what the README's
 * credential table promises, so they double as executable documentation.
 */
describe('POST /provider/validate', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    ctx.app.get(MockProviderService).resetTransientState();
  });

  const validate = (body: object) =>
    request(ctx.app.getHttpServer()).post('/provider/validate').send(body);

  const credentials = (accountId: string) => ({ accountId, apiKey: 'sk_test_1234' });

  it('returns valid credentials with the available items', async () => {
    const { body } = await validate(credentials('acct_valid')).expect(200);

    const parsed = providerValidateResponseSchema.parse(body);
    expect(parsed.status).toBe('valid');
    expect(parsed.status === 'valid' && parsed.items.length).toBeGreaterThan(0);
  });

  it('returns partial with both items and warnings', async () => {
    const { body } = await validate(credentials('acct_partial')).expect(200);

    const parsed = providerValidateResponseSchema.parse(body);
    expect(parsed.status).toBe('partial');
    if (parsed.status === 'partial') {
      expect(parsed.items.length).toBeGreaterThan(0);
      expect(parsed.warnings.length).toBeGreaterThan(0);
    }
  });

  it('returns invalid with a reason', async () => {
    const { body } = await validate(credentials('acct_invalid')).expect(200);

    const parsed = providerValidateResponseSchema.parse(body);
    expect(parsed.status).toBe('invalid');
    expect(parsed.status === 'invalid' && parsed.reason).toBeTruthy();
  });

  it('returns 503 when the provider is unavailable', async () => {
    await validate(credentials('acct_unavailable')).expect(503);
  });

  it('fails once then recovers for the flaky account', async () => {
    await validate(credentials('acct_flaky')).expect(503);
    const { body } = await validate(credentials('acct_flaky')).expect(200);

    expect(providerValidateResponseSchema.parse(body).status).toBe('valid');
  });

  it('treats an unrecognised account as healthy, so the happy path is the default', async () => {
    const { body } = await validate(credentials('some-real-looking-account')).expect(200);

    expect(providerValidateResponseSchema.parse(body).status).toBe('valid');
  });

  it.each([
    ['a missing api key', { accountId: 'acct_valid' }],
    ['a missing account id', { apiKey: 'sk_test_1234' }],
    ['an empty account id', { accountId: '', apiKey: 'sk_test_1234' }],
  ])('rejects %s with 400', async (_label, body) => {
    await validate(body).expect(400);
  });
});
