import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ProviderValidateRequest, ProviderValidateResponse } from '@onboarding/contracts';
import type { Env } from '../config/env';
import { MockProviderService } from './mock-provider.service';
import { ProviderUnavailableError, type ProviderClient } from './provider-client';

@Injectable()
export class MockProviderClient implements ProviderClient {
  constructor(
    private readonly provider: MockProviderService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async validate(request: ProviderValidateRequest): Promise<ProviderValidateResponse> {
    const timeoutMs = this.config.get('PROVIDER_TIMEOUT_MS', { infer: true });

    // The deadline is enforced here, by the caller, rather than trusted to the
    // Provider — a hung dependency must not hold an attempt open indefinitely.
    // The abandoned call may still resolve later; its result is discarded,
    // which is precisely what a real HTTP client's timeout does.
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ProviderUnavailableError(`Provider timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    try {
      return await Promise.race([this.provider.validate(request), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}
