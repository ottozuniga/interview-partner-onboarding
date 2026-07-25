import { Module } from '@nestjs/common';
import { ProviderMockModule } from '../provider-mock/provider-mock.module';
import { GoLiveService } from './go-live.service';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { ValidationService } from './validation.service';

@Module({
  imports: [ProviderMockModule],
  controllers: [SessionController],
  providers: [SessionService, ValidationService, GoLiveService],
  exports: [SessionService],
})
export class OnboardingModule {}
