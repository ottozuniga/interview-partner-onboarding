import { Module } from '@nestjs/common';
import { ProviderMockModule } from '../provider-mock/provider-mock.module';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { ValidationService } from './validation.service';

@Module({
  imports: [ProviderMockModule],
  controllers: [SessionController],
  providers: [SessionService, ValidationService],
  exports: [SessionService],
})
export class OnboardingModule {}
