import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ProviderValidateRequest, ProviderValidateResponse } from '@onboarding/contracts';
import type { Env } from '../config/env';
import { ProviderUnavailableError } from './provider-client';

/**
 * Which behaviour a given accountId triggers. Documented in the README.
 * Anything unrecognised behaves like a healthy account, so the happy path is
 * the default rather than a special case.
 */
export const PROVIDER_SCENARIOS = {
  VALID: 'acct_valid',
  PARTIAL: 'acct_partial',
  INVALID: 'acct_invalid',
  UNAVAILABLE: 'acct_unavailable',
  TIMEOUT: 'acct_timeout',
  FLAKY: 'acct_flaky',
} as const;

const CATALOGUE = [
  { externalId: 'itm_std_freight', name: 'Standard Freight', status: 'ok' as const },
  { externalId: 'itm_express', name: 'Express Delivery', status: 'ok' as const },
  { externalId: 'itm_bulk', name: 'Bulk Haulage', status: 'ok' as const },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stands in for the external Provider. Lives in this app for convenience, but
 * is deliberately kept behind the same interface a real one would sit behind
 * and knows nothing about onboarding sessions.
 */
@Injectable()
export class MockProviderService {
  private readonly logger = new Logger(MockProviderService.name);

  /** Per-account call counts, backing the `acct_flaky` scenario. */
  private readonly callCounts = new Map<string, number>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Test helper: forgets which accounts have already failed once. */
  resetTransientState(): void {
    this.callCounts.clear();
  }

  async validate({ accountId }: ProviderValidateRequest): Promise<ProviderValidateResponse> {
    const attempts = (this.callCounts.get(accountId) ?? 0) + 1;
    this.callCounts.set(accountId, attempts);

    await sleep(this.config.get('PROVIDER_LATENCY_MS', { infer: true }));

    switch (accountId) {
      case PROVIDER_SCENARIOS.PARTIAL:
        return {
          status: 'partial',
          items: [CATALOGUE[0], CATALOGUE[1]],
          warnings: [
            'Bulk Haulage could not be imported: missing tariff configuration.',
            'Express Delivery is missing a pickup window and will use the default.',
          ],
        };

      case PROVIDER_SCENARIOS.INVALID:
        return {
          status: 'invalid',
          reason: 'No account matches those credentials, or the API key has been revoked.',
        };

      case PROVIDER_SCENARIOS.UNAVAILABLE:
        throw new ProviderUnavailableError('Provider returned 503 Service Unavailable');

      case PROVIDER_SCENARIOS.TIMEOUT:
        // Outlast the client's deadline, so the timeout is enforced by the
        // caller rather than politely reported by the callee.
        await sleep(this.config.get('PROVIDER_TIMEOUT_MS', { infer: true }) * 3);
        return { status: 'valid', items: CATALOGUE };

      case PROVIDER_SCENARIOS.FLAKY:
        if (attempts === 1) {
          this.logger.debug(`Failing first call for ${accountId} to exercise retry`);
          throw new ProviderUnavailableError('Provider returned 503 Service Unavailable');
        }
        return { status: 'valid', items: CATALOGUE };

      default:
        return { status: 'valid', items: CATALOGUE };
    }
  }
}
