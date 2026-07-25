import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ProviderValidateRequest,
  ProviderValidateResponse,
  StartValidationRequest,
  ValidateResponse,
} from '@onboarding/contracts';
import type { AttemptStatus, Prisma } from '@prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  PROVIDER_CLIENT,
  ProviderUnavailableError,
  type ProviderClient,
} from '../provider-mock/provider-client';
import { DECISIVE_STATUSES } from './session-view';
import { SessionService } from './session.service';

/** What a finished attempt records, whatever the Provider said. */
interface AttemptOutcome {
  status: Exclude<AttemptStatus, 'RUNNING'>;
  reason: string | null;
  warnings: Prisma.InputJsonValue;
  itemsSnapshot: Prisma.InputJsonValue;
}

/** Bounded, and only retried when a race resolves the contention for us. */
const MAX_START_ATTEMPTS = 3;

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    @Inject(PROVIDER_CLIENT) private readonly provider: ProviderClient,
  ) {}

  /**
   * Starts a validation, or joins the one already in flight.
   *
   * Returns as soon as the attempt exists rather than waiting for the
   * Provider, so a slow dependency cannot hold the request open and the
   * partner can watch progress by polling the session.
   */
  async startValidation({ revalidate }: StartValidationRequest): Promise<ValidateResponse> {
    // Also reaps abandoned attempts, so a session left RUNNING by a killed
    // process does not block validation forever.
    const session = await this.sessions.getCurrentSession();

    if (session.status !== 'IN_PROGRESS') {
      throw new ConflictException('This onboarding session is already complete.');
    }

    const { providerAccountId, providerApiKey, credentialsFingerprint } = session;
    if (!providerAccountId || !providerApiKey || !credentialsFingerprint) {
      throw new ConflictException(
        'Enter your company details and Provider credentials before validating.',
      );
    }

    for (let tries = 0; tries < MAX_START_ATTEMPTS; tries += 1) {
      const reusable = await this.findReusableAttempt(
        session.id,
        credentialsFingerprint,
        revalidate,
      );
      if (reusable) {
        return { attemptId: reusable.id, status: reusable.status, deduplicated: true };
      }

      try {
        const attempt = await this.prisma.validationAttempt.create({
          data: { sessionId: session.id, status: 'RUNNING', credentialsFingerprint },
        });

        // Deliberately not awaited: the HTTP response returns now, and the
        // outcome is written to the attempt row when the Provider answers.
        // runAttempt never rejects, so this cannot become an unhandled
        // rejection.
        void this.runAttempt(attempt.id, {
          accountId: providerAccountId,
          apiKey: providerApiKey,
        });

        return { attemptId: attempt.id, status: 'RUNNING', deduplicated: false };
      } catch (error: unknown) {
        if (!isUniqueViolation(error, 'sessionId')) {
          throw error;
        }

        // Lost the insert race. Loop: the check at the top of the next pass
        // re-reads and will find either the winner's in-flight attempt or, if
        // it has already finished, its result.
      }
    }

    throw new ConflictException(
      'Could not start a validation attempt because another one kept taking the slot. Please try again.',
    );
  }

  /**
   * An attempt that makes calling the Provider unnecessary right now.
   *
   * Two clicks a few milliseconds apart must produce one Provider call. The
   * in-flight unique index alone only achieves that when the Provider is
   * slower than the gap between the clicks — a race we usually win rather than
   * a guarantee. Reusing an existing *answer* for these exact credentials
   * closes it regardless of how fast the Provider is.
   *
   * A transient failure is deliberately not reusable: it is not an answer, so
   * a retry genuinely re-calls. Changing credentials changes the fingerprint
   * and so re-calls too. Re-checking unchanged, already-answered credentials
   * is a deliberate act, and has to ask for it.
   */
  private async findReusableAttempt(
    sessionId: string,
    credentialsFingerprint: string,
    revalidate: boolean,
  ) {
    const running = await this.prisma.validationAttempt.findFirst({
      where: { sessionId, status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
    });

    // An in-flight attempt is joined even when re-validation was requested:
    // the index permits only one at a time regardless.
    if (running || revalidate) {
      return running;
    }

    return this.prisma.validationAttempt.findFirst({
      where: {
        sessionId,
        credentialsFingerprint,
        status: { in: [...DECISIVE_STATUSES] },
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  /** Runs the Provider call and records the result. Never rejects. */
  private async runAttempt(attemptId: string, credentials: ProviderValidateRequest): Promise<void> {
    let outcome: AttemptOutcome;

    try {
      outcome = toOutcome(await this.provider.validate(credentials));
    } catch (error: unknown) {
      outcome = {
        status: 'TRANSIENT_FAILURE',
        reason:
          error instanceof ProviderUnavailableError
            ? error.message
            : `Unexpected failure calling the Provider: ${String(error)}`,
        warnings: [],
        itemsSnapshot: [],
      };
    }

    try {
      await this.settle(attemptId, outcome);
    } catch (error: unknown) {
      // Nothing left to do but leave the row RUNNING; the stale reaper will
      // write it off, and the partner can retry safely.
      this.logger.error(`Could not record the outcome of attempt ${attemptId}`, error);
    }
  }

  private async settle(attemptId: string, outcome: AttemptOutcome): Promise<void> {
    const { count } = await this.prisma.validationAttempt.updateMany({
      // Conditional on RUNNING: an attempt that was already reaped as abandoned
      // must stay written off. Without this, a very late Provider reply would
      // resurrect it and flip the partner's view back.
      where: { id: attemptId, status: 'RUNNING' },
      data: { ...outcome, finishedAt: new Date() },
    });

    if (count === 0) {
      this.logger.warn(
        `Discarded a Provider result for attempt ${attemptId}: it was no longer running.`,
      );
    }
  }
}

function toOutcome(response: ProviderValidateResponse): AttemptOutcome {
  switch (response.status) {
    case 'valid':
      return { status: 'VALID', reason: null, warnings: [], itemsSnapshot: response.items };
    case 'partial':
      return {
        status: 'PARTIAL',
        reason: null,
        warnings: response.warnings,
        itemsSnapshot: response.items,
      };
    case 'invalid':
      return {
        status: 'INVALID',
        reason: response.reason,
        warnings: [],
        itemsSnapshot: [],
      };
  }
}
