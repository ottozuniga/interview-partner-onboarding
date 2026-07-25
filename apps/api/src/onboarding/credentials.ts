import { createHash } from 'node:crypto';

/**
 * A stable identifier for a set of Provider credentials.
 *
 * Every validation attempt records the fingerprint it tested. Comparing that
 * against the session's current fingerprint is what makes "the partner edited
 * their credentials, so the previous result no longer counts" fall out of a
 * simple equality check instead of explicit invalidation logic.
 *
 * Not a security control — the API key is stored alongside it (see README).
 */
export function fingerprintCredentials(accountId: string, apiKey: string): string {
  return createHash('sha256').update(`${accountId}:${apiKey}`).digest('hex');
}
