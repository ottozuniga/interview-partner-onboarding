import type { ProviderValidateRequest, ProviderValidateResponse } from '@onboarding/contracts';

export const PROVIDER_CLIENT = Symbol('PROVIDER_CLIENT');

/**
 * The seam between our system and the Provider.
 *
 * Everything behind this interface is someone else's infrastructure: it can be
 * slow, it can be down, and it can answer in ways we did not ask for. Swapping
 * the mock for a real HTTP client is a change to the binding in
 * ProviderMockModule and nothing else.
 */
export interface ProviderClient {
  validate(request: ProviderValidateRequest): Promise<ProviderValidateResponse>;
}

/**
 * The Provider could not be reached, or did not answer in time.
 *
 * Deliberately distinct from an `invalid` response: this says nothing about
 * whether the credentials are good, so it must never revoke a result the
 * partner already earned. It is always safe to retry.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}
