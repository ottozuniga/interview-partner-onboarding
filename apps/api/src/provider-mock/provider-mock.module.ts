import { Module } from '@nestjs/common';
import { MockProviderClient } from './mock-provider.client';
import { MockProviderService } from './mock-provider.service';
import { PROVIDER_CLIENT } from './provider-client';
import { ProviderMockController } from './provider-mock.controller';

/**
 * Swapping the mock for a real integration is a change to this binding alone.
 */
@Module({
  controllers: [ProviderMockController],
  providers: [MockProviderService, { provide: PROVIDER_CLIENT, useClass: MockProviderClient }],
  exports: [PROVIDER_CLIENT, MockProviderService],
})
export class ProviderMockModule {}
