import { z } from 'zod';
import { providerItemSchema } from './provider.js';

/** Where the wizard should render. Derived server-side, never stored. */
export const wizardStepSchema = z.enum(['DETAILS', 'VALIDATE', 'REVIEW', 'LIVE']);
export type WizardStep = z.infer<typeof wizardStepSchema>;

export const sessionStatusSchema = z.enum(['IN_PROGRESS', 'COMPLETED', 'ABANDONED']);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const attemptStatusSchema = z.enum([
  'RUNNING',
  'VALID',
  'PARTIAL',
  'INVALID',
  'TRANSIENT_FAILURE',
]);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

/** Terminal outcomes that represent a real answer from the Provider. */
export const ADVANCEABLE_ATTEMPT_STATUSES = ['VALID', 'PARTIAL'] as const;

// --- Requests -------------------------------------------------------------

export const saveDetailsRequestSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name is required').max(200),
  accountId: z.string().trim().min(1, 'Provider account ID is required').max(200),
  apiKey: z.string().trim().min(1, 'Provider API key is required').max(500),
});
export type SaveDetailsRequest = z.infer<typeof saveDetailsRequestSchema>;

export const completeRequestSchema = z.object({
  /**
   * Required to be `true` when the effective validation was PARTIAL: the
   * partner has seen the warnings and chosen to proceed anyway.
   */
  acknowledgedWarnings: z.boolean().optional().default(false),
});
export type CompleteRequest = z.infer<typeof completeRequestSchema>;

// --- Views ----------------------------------------------------------------

export const attemptViewSchema = z.object({
  id: z.string(),
  status: attemptStatusSchema,
  reason: z.string().nullable(),
  warnings: z.array(z.string()),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  /** False when this attempt tested credentials that have since been edited. */
  matchesCurrentCredentials: z.boolean(),
});
export type AttemptView = z.infer<typeof attemptViewSchema>;

/**
 * The latest non-transient, terminal attempt for the *current* credentials.
 * Its absence is what holds the partner on the Validate step.
 */
export const effectiveValidationSchema = z.object({
  attemptId: z.string(),
  status: z.enum(ADVANCEABLE_ATTEMPT_STATUSES),
  warnings: z.array(z.string()),
  items: z.array(providerItemSchema),
  validatedAt: z.string(),
});
export type EffectiveValidation = z.infer<typeof effectiveValidationSchema>;

export const validateResponseSchema = z.object({
  attemptId: z.string(),
  status: attemptStatusSchema,
  /** True when this call joined an already-running attempt rather than starting one. */
  deduplicated: z.boolean(),
});
export type ValidateResponse = z.infer<typeof validateResponseSchema>;

/**
 * The single payload the entire wizard renders from. The client keeps no
 * wizard state of its own, which is what makes reload / incognito / server
 * restart resume correctly without any special handling.
 */
export const sessionViewSchema = z.object({
  sessionId: z.string(),
  status: sessionStatusSchema,
  step: wizardStepSchema,

  companyName: z.string().nullable(),
  providerAccountId: z.string().nullable(),
  /** Masked form, e.g. "••••••4321". The raw key is never sent to the client. */
  apiKeyMasked: z.string().nullable(),
  hasApiKey: z.boolean(),

  /** Most recent attempt of any kind — drives the live status banner. */
  latestAttempt: attemptViewSchema.nullable(),
  /** The result the partner is allowed to act on. Null until one exists. */
  effectiveValidation: effectiveValidationSchema.nullable(),

  canGoLive: z.boolean(),
  requiresWarningAck: z.boolean(),

  completedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type SessionView = z.infer<typeof sessionViewSchema>;
