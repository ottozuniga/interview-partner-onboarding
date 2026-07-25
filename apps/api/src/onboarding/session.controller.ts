import { Body, Controller, Get, Put } from '@nestjs/common';
import type { SaveDetailsRequest, SessionView } from '@onboarding/contracts';
import { saveDetailsRequestSchema } from '@onboarding/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionService } from './session.service';

@Controller('api/onboarding/session')
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  /** Resume. The single read the entire wizard renders from. */
  @Get()
  getSession(): Promise<SessionView> {
    return this.sessions.getView();
  }

  /** Step 1. */
  @Put('details')
  saveDetails(
    @Body(new ZodValidationPipe(saveDetailsRequestSchema)) body: SaveDetailsRequest,
  ): Promise<SessionView> {
    return this.sessions.saveDetails(body);
  }
}
