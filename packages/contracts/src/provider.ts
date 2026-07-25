import { z } from 'zod';

/**
 * The external Provider's contract. Mocked in-app, but shaped exactly as a real
 * third party would be so the mock can be swapped for a real client later.
 */

export const providerItemSchema = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['ok', 'failed']),
});
export type ProviderItem = z.infer<typeof providerItemSchema>;

export const providerValidateRequestSchema = z.object({
  accountId: z.string().min(1, 'accountId is required'),
  apiKey: z.string().min(1, 'apiKey is required'),
});
export type ProviderValidateRequest = z.infer<typeof providerValidateRequestSchema>;

/**
 * Discriminated on `status`, so an exhaustive switch in the caller is enforced
 * by the compiler. A fourth outcome — the Provider being unreachable — is
 * deliberately absent: it is a transport failure (503 / timeout), not a
 * response body, and is represented by the client throwing.
 */
export const providerValidateResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('valid'),
    items: z.array(providerItemSchema),
  }),
  z.object({
    status: z.literal('partial'),
    items: z.array(providerItemSchema),
    warnings: z.array(z.string()).min(1),
  }),
  z.object({
    status: z.literal('invalid'),
    reason: z.string().min(1),
  }),
]);
export type ProviderValidateResponse = z.infer<typeof providerValidateResponseSchema>;
