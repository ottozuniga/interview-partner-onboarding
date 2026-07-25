import type {
  AttemptStatus,
  ProviderItem,
  SessionStatus,
  SessionView,
  WizardStep,
} from '@onboarding/contracts';

/**
 * Plain snapshots of the persisted rows. Deliberately not Prisma types: this
 * module is the heart of the resume behaviour, so it stays a pure function of
 * plain data that can be exhaustively unit-tested without a database.
 */
export interface SessionSnapshot {
  id: string;
  status: SessionStatus;
  companyName: string | null;
  providerAccountId: string | null;
  apiKey: string | null;
  credentialsFingerprint: string | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface AttemptSnapshot {
  id: string;
  status: AttemptStatus;
  credentialsFingerprint: string;
  reason: string | null;
  warnings: string[];
  items: ProviderItem[];
  startedAt: Date;
  finishedAt: Date | null;
}

/**
 * Statuses that represent an actual answer from the Provider about a given set
 * of credentials.
 *
 * RUNNING is excluded because it is not an answer yet. TRANSIENT_FAILURE is
 * excluded because it is a statement about the network, not about the
 * credentials — which is exactly what stops a 503 on retry from revoking a
 * result the partner already earned. INVALID *is* included: the Provider
 * actively rejected these credentials, so an earlier VALID no longer holds.
 */
export const DECISIVE_STATUSES: readonly AttemptStatus[] = ['VALID', 'PARTIAL', 'INVALID'];

function newestFirst(attempts: readonly AttemptSnapshot[]): AttemptSnapshot[] {
  return [...attempts].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

/**
 * The most recent attempt that actually answers the question "are the
 * credentials currently on this session any good?". Attempts that tested
 * *different* credentials are invisible here, which is what makes editing
 * credentials invalidate a prior result without any explicit cache-busting.
 */
export function findDecisiveAttempt(
  session: SessionSnapshot,
  attempts: readonly AttemptSnapshot[],
): AttemptSnapshot | null {
  if (!session.credentialsFingerprint) {
    return null;
  }

  return (
    newestFirst(attempts).find(
      (attempt) =>
        attempt.credentialsFingerprint === session.credentialsFingerprint &&
        DECISIVE_STATUSES.includes(attempt.status),
    ) ?? null
  );
}

/** The decisive attempt, but only when it permits going live. */
export function findEffectiveValidation(
  session: SessionSnapshot,
  attempts: readonly AttemptSnapshot[],
): AttemptSnapshot | null {
  const decisive = findDecisiveAttempt(session, attempts);
  if (!decisive) {
    return null;
  }

  return decisive.status === 'VALID' || decisive.status === 'PARTIAL' ? decisive : null;
}

export function deriveStep(
  session: SessionSnapshot,
  attempts: readonly AttemptSnapshot[],
): WizardStep {
  if (session.status === 'COMPLETED') {
    return 'LIVE';
  }

  if (!session.credentialsFingerprint) {
    return 'DETAILS';
  }

  return findEffectiveValidation(session, attempts) ? 'REVIEW' : 'VALIDATE';
}

/**
 * Shows that a key is on file without disclosing it. The raw key is never sent
 * to the client; this is the only representation that leaves the server.
 */
export function maskApiKey(apiKey: string | null): string | null {
  if (!apiKey) {
    return null;
  }

  return apiKey.length > 4 ? `••••${apiKey.slice(-4)}` : '••••';
}

/** The complete payload the wizard renders from. */
export function buildSessionView(
  session: SessionSnapshot,
  attempts: readonly AttemptSnapshot[],
): SessionView {
  const [latest] = newestFirst(attempts);
  const effective = findEffectiveValidation(session, attempts);

  return {
    sessionId: session.id,
    status: session.status,
    step: deriveStep(session, attempts),

    companyName: session.companyName,
    providerAccountId: session.providerAccountId,
    apiKeyMasked: maskApiKey(session.apiKey),
    hasApiKey: session.apiKey !== null,

    latestAttempt: latest
      ? {
          id: latest.id,
          status: latest.status,
          reason: latest.reason,
          warnings: latest.warnings,
          startedAt: latest.startedAt.toISOString(),
          finishedAt: latest.finishedAt?.toISOString() ?? null,
          matchesCurrentCredentials:
            latest.credentialsFingerprint === session.credentialsFingerprint,
        }
      : null,

    effectiveValidation: effective
      ? {
          attemptId: effective.id,
          // Narrowed by findEffectiveValidation.
          status: effective.status as 'VALID' | 'PARTIAL',
          warnings: effective.warnings,
          items: effective.items,
          validatedAt: (effective.finishedAt ?? effective.startedAt).toISOString(),
        }
      : null,

    canGoLive: session.status === 'IN_PROGRESS' && effective !== null,
    requiresWarningAck: effective?.status === 'PARTIAL',

    completedAt: session.completedAt?.toISOString() ?? null,
    updatedAt: session.updatedAt.toISOString(),
  };
}
