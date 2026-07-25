import { z } from 'zod';

/**
 * Environment is validated once, at boot, and fails loudly. A missing
 * DATABASE_URL should stop the process immediately rather than surface as a
 * confusing runtime error on the first request.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  /** The single hardcoded partner. Auth is out of scope. */
  PARTNER_NAME: z.string().min(1).default('Acme Logistics'),

  /** How long to wait on the Provider before calling it a transient failure. */
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  /** Artificial Provider latency, so RUNNING is observable in the UI. */
  PROVIDER_LATENCY_MS: z.coerce.number().int().nonnegative().default(1200),

  /**
   * Added to PROVIDER_TIMEOUT_MS before a still-RUNNING attempt is treated as
   * abandoned. Covers the window where the process died after inserting the
   * attempt but before writing its outcome.
   */
  ATTEMPT_STALE_GRACE_MS: z.coerce.number().int().nonnegative().default(15000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}

/** Total age at which a RUNNING attempt is considered abandoned. */
export function staleAttemptThresholdMs(env: Env): number {
  return env.PROVIDER_TIMEOUT_MS + env.ATTEMPT_STALE_GRACE_MS;
}
