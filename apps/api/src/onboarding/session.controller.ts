import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import type {
  SaveDetailsRequest,
  SessionView,
  StartValidationRequest,
  ValidateResponse,
} from '@onboarding/contracts';
import { saveDetailsRequestSchema, startValidationRequestSchema } from '@onboarding/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionService } from './session.service';
import { ValidationService } from './validation.service';

@Controller('api/onboarding/session')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly validation: ValidationService,
  ) {}

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

  /**
   * Step 2. Accepted, not completed: the Provider call outruns the request, so
   * the client polls GET / for the outcome. Safe to call twice.
   */
  @Post('validate')
  @HttpCode(202)
  startValidation(
    @Body(new ZodValidationPipe(startValidationRequestSchema)) body: StartValidationRequest,
  ): Promise<ValidateResponse> {
    return this.validation.startValidation(body);
  }
}
