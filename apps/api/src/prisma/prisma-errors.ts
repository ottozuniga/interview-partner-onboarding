import { Prisma } from '@prisma/client';

/**
 * A unique-constraint violation (P2002).
 *
 * Losing this race is a normal, expected outcome here rather than an error:
 * it is how the partial unique indexes serialise concurrent session creation
 * and concurrent validation starts. The loser reads the winner's row.
 */
export function isUniqueViolation(error: unknown, target?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  if (!target) {
    return true;
  }

  // Prisma reports the violated constraint as the column list, even for the
  // hand-written partial indexes it does not know about — verified against
  // Postgres 18: `{"modelName":"OnboardingSession","target":["partnerId"]}`.
  const meta = error.meta as { target?: string | string[] } | undefined;
  const reported = Array.isArray(meta?.target) ? meta.target.join(',') : (meta?.target ?? '');

  return reported.includes(target);
}
