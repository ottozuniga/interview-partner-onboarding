import { Body, Controller, HttpCode, Post, ServiceUnavailableException } from '@nestjs/common';
import type { ProviderValidateRequest, ProviderValidateResponse } from '@onboarding/contracts';
import { providerValidateRequestSchema } from '@onboarding/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MockProviderService } from './mock-provider.service';
import { ProviderUnavailableError } from './provider-client';

/**
 * The Provider's documented contract, exposed as a real HTTP endpoint so it
 * can be exercised with curl and read as a spec. The onboarding service does
 * not call this route — it holds a ProviderClient, and both are backed by the
 * same MockProviderService, so the two can never disagree.
 */
@Controller('provider')
export class ProviderMockController {
  constructor(private readonly provider: MockProviderService) {}

  @Post('validate')
  // The Provider's contract specifies 200 for every answered outcome —
  // including `invalid`, which is a successful call reporting bad credentials.
  // Nest would otherwise default a POST to 201.
  @HttpCode(200)
  async validate(
    @Body(new ZodValidationPipe(providerValidateRequestSchema)) body: ProviderValidateRequest,
  ): Promise<ProviderValidateResponse> {
    try {
      return await this.provider.validate(body);
    } catch (error: unknown) {
      if (error instanceof ProviderUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }
}
