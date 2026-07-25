import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CompleteRequest, SessionView } from '@onboarding/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { findEffectiveValidation } from './session-view';
import {
  SessionService,
  toAttemptSnapshot,
  toSessionSnapshot,
  type SessionWithAttempts,
} from './session.service';

@Injectable()
export class GoLiveService {
  private readonly logger = new Logger(GoLiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * The all-or-nothing transition. Either the session is complete and the
   * partner is live, or nothing changed at all.
   */
  async goLive({ acknowledgedWarnings }: CompleteRequest): Promise<SessionView> {
    const session = await this.sessions.getCurrentSession();

    // Already live. Submitting again is not an error — the partner may simply
    // have refreshed or double-submitted — so report the state as it stands.
    if (session.status === 'COMPLETED') {
      return this.sessions.getView();
    }

    // Fail fast on the state we have read, so the common rejection paths never
    // open a transaction. The authoritative check is repeated inside it.
    assertReadyToGoLive(session, acknowledgedWarnings);

    try {
      await this.runTransition(session.id, acknowledgedWarnings);
    } catch (error: unknown) {
      // A deliberate rejection (not validated yet, warnings unacknowledged)
      // is an answer, not a fault — pass it through untouched.
      if (error instanceof HttpException) {
        throw error;
      }

      // Anything else means the transaction rolled back, so the partner is
      // exactly where they started. Say so: this is the one failure mode where
      // "just try again" is guaranteed safe, and a bare 500 would leave them
      // wondering whether they are half-live.
      this.logger.error(
        `Go-live failed for session ${session.id}. No changes were committed.`,
        error,
      );
      throw new ServiceUnavailableException(
        'Could not complete go-live. Nothing was changed, so it is safe to try again.',
      );
    }

    return this.sessions.getView();
  }

  private async runTransition(sessionId: string, acknowledgedWarnings: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Re-read inside the transaction. The checks above ran against a
      // snapshot that a concurrent request could already have invalidated —
      // by editing credentials, or by going live first.
      const fresh = await tx.onboardingSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: { attempts: { orderBy: { startedAt: 'desc' } } },
      });

      if (fresh.status !== 'IN_PROGRESS') {
        // Someone else completed it. Their transition stands; ours is a no-op.
        return;
      }

      assertReadyToGoLive(fresh, acknowledgedWarnings);

      const { count } = await tx.onboardingSession.updateMany({
        // Guarded on both the status and the version this decision was made
        // against. Under READ COMMITTED a competing transaction blocks here
        // and then re-tests the predicate against the committed row, so
        // exactly one of them can match.
        where: { id: fresh.id, status: 'IN_PROGRESS', version: fresh.version },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          version: { increment: 1 },
        },
      });

      if (count === 0) {
        return;
      }

      // In the same transaction as the session transition: a partner marked
      // live against an incomplete session, or a completed session whose
      // partner is not live, are both states this system must never be in.
      await tx.partner.update({
        where: { id: fresh.partnerId },
        data: { isLive: true, liveAt: new Date() },
      });

      this.logger.log(`Partner ${fresh.partnerId} is live (session ${fresh.id})`);
    });
  }
}

/**
 * Guards the transition. Shared between the pre-check and the in-transaction
 * re-check so the two can never disagree about what "ready" means.
 */
function assertReadyToGoLive(session: SessionWithAttempts, acknowledgedWarnings: boolean): void {
  const effective = findEffectiveValidation(
    toSessionSnapshot(session),
    session.attempts.map(toAttemptSnapshot),
  );

  if (!effective) {
    throw new ConflictException(
      'Validate your Provider credentials before going live. If you changed them, run the check again.',
    );
  }

  if (effective.status === 'PARTIAL' && !acknowledgedWarnings) {
    throw new BadRequestException(
      'Some items could not be imported. Acknowledge the warnings to continue.',
    );
  }
}
