import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import type {
  CompleteRequest,
  SaveDetailsRequest,
  SessionView,
  StartValidationRequest,
  ValidateResponse,
} from '@onboarding/contracts';
import {
  completeRequestSchema,
  saveDetailsRequestSchema,
  startValidationRequestSchema,
} from '@onboarding/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { GoLiveService } from './go-live.service';
import { SessionService } from './session.service';
import { ValidationService } from './validation.service';

@Controller('api/onboarding/session')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly validation: ValidationService,
    private readonly goLive: GoLiveService,
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

  /** Step 3. All-or-nothing, and safe to submit twice. */
  @Post('complete')
  @HttpCode(200)
  complete(
    @Body(new ZodValidationPipe(completeRequestSchema)) body: CompleteRequest,
  ): Promise<SessionView> {
    return this.goLive.goLive(body);
  }
}
