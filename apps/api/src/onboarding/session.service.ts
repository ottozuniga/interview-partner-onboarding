import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SaveDetailsRequest, SessionView } from '@onboarding/contracts';
import { providerItemSchema } from '@onboarding/contracts';
import type { OnboardingSession, Partner, ValidationAttempt } from '@prisma/client';
import type { Env } from '../config/env';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { fingerprintCredentials } from './credentials';
import { buildSessionView, type AttemptSnapshot, type SessionSnapshot } from './session-view';

export type SessionWithAttempts = OnboardingSession & { attempts: ValidationAttempt[] };

/** Newest attempt first — the order every consumer of a session assumes. */
const WITH_ATTEMPTS = { attempts: { orderBy: { startedAt: 'desc' } } } as const;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * The resume entry point. Everything the wizard shows comes from here, which
   * is why the client can store nothing at all.
   */
  async getView(): Promise<SessionView> {
    return toView(await this.getCurrentSession());
  }

  async saveDetails(input: SaveDetailsRequest): Promise<SessionView> {
    const session = await this.getCurrentSession();

    if (session.status !== 'IN_PROGRESS') {
      throw new ConflictException(
        'This onboarding session is already complete and can no longer be edited.',
      );
    }

    // Conditional on the status rather than a bare update on the id: the check
    // above is a read, and the session could have gone live in the gap. Letting
    // Postgres re-test the predicate at write time closes that window.
    const { count } = await this.prisma.onboardingSession.updateMany({
      where: { id: session.id, status: 'IN_PROGRESS' },
      data: {
        companyName: input.companyName,
        providerAccountId: input.accountId,
        providerApiKey: input.apiKey,
        // Deterministic, so resubmitting identical credentials leaves any
        // existing validation result intact rather than silently discarding it.
        credentialsFingerprint: fingerprintCredentials(input.accountId, input.apiKey),
      },
    });

    if (count === 0) {
      throw new ConflictException(
        'This onboarding session was completed while you were editing it.',
      );
    }

    return this.getViewById(session.id);
  }

  /**
   * The session the partner should currently see:
   *   1. their open session, if they have one;
   *   2. otherwise their most recent completed one, so reloading after go-live
   *      shows "you're live" rather than restarting the wizard;
   *   3. otherwise a fresh session.
   */
  async getCurrentSession(): Promise<SessionWithAttempts> {
    const partner = await this.getPartner();

    const open = await this.prisma.onboardingSession.findFirst({
      where: { partnerId: partner.id, status: 'IN_PROGRESS' },
      include: WITH_ATTEMPTS,
    });
    if (open) {
      return open;
    }

    const completed = await this.prisma.onboardingSession.findFirst({
      where: { partnerId: partner.id, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      include: WITH_ATTEMPTS,
    });
    if (completed) {
      return completed;
    }

    return this.createOpenSession(partner.id);
  }

  private async getViewById(sessionId: string): Promise<SessionView> {
    const session = await this.prisma.onboardingSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: WITH_ATTEMPTS,
    });

    return toView(session);
  }

  private async createOpenSession(partnerId: string): Promise<SessionWithAttempts> {
    try {
      return await this.prisma.onboardingSession.create({
        data: { partnerId },
        include: WITH_ATTEMPTS,
      });
    } catch (error: unknown) {
      // Lost the race against a concurrent first visit. The partial unique
      // index guarantees the winner's session exists, so read it instead of
      // creating a second one that would make "resume" ambiguous.
      if (isUniqueViolation(error, 'partnerId')) {
        return await this.prisma.onboardingSession.findFirstOrThrow({
          where: { partnerId, status: 'IN_PROGRESS' },
          include: WITH_ATTEMPTS,
        });
      }
      throw error;
    }
  }

  /**
   * Auth is out of scope: there is exactly one partner and every request
   * resolves to it.
   *
   * Read first so the common path stays a pure read; the upsert only runs on
   * the very first request ever, and absorbs the race if several arrive at
   * once. This also means a forgotten `db:seed` cannot turn into a confusing
   * 500 on first use.
   */
  private async getPartner(): Promise<Partner> {
    const name = this.config.get('PARTNER_NAME', { infer: true });

    const existing = await this.prisma.partner.findUnique({ where: { name } });
    if (existing) {
      return existing;
    }

    return this.prisma.partner.upsert({ where: { name }, update: {}, create: { name } });
  }
}

export function toSessionSnapshot(session: OnboardingSession): SessionSnapshot {
  return {
    id: session.id,
    status: session.status,
    companyName: session.companyName,
    providerAccountId: session.providerAccountId,
    apiKey: session.providerApiKey,
    credentialsFingerprint: session.credentialsFingerprint,
    completedAt: session.completedAt,
    updatedAt: session.updatedAt,
  };
}

export function toAttemptSnapshot(attempt: ValidationAttempt): AttemptSnapshot {
  // The JSON columns are parsed rather than cast: a malformed row should
  // degrade to "no items" instead of crashing every read of the session.
  const items = providerItemSchema.array().safeParse(attempt.itemsSnapshot);
  const warnings = Array.isArray(attempt.warnings)
    ? attempt.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];

  return {
    id: attempt.id,
    status: attempt.status,
    credentialsFingerprint: attempt.credentialsFingerprint,
    reason: attempt.reason,
    warnings,
    items: items.success ? items.data : [],
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
  };
}

export function toView(session: SessionWithAttempts): SessionView {
  return buildSessionView(toSessionSnapshot(session), session.attempts.map(toAttemptSnapshot));
}
