import type { AttemptSnapshot, SessionSnapshot } from './session-view';
import { buildSessionView, deriveStep, findEffectiveValidation } from './session-view';

const FINGERPRINT = 'fp-current';
const OLD_FINGERPRINT = 'fp-previous';

function session(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    id: 'session-1',
    status: 'IN_PROGRESS',
    companyName: 'CompanyABC',
    providerAccountId: 'acct_valid',
    apiKey: 'sk_live_9876543210',
    credentialsFingerprint: FINGERPRINT,
    completedAt: null,
    updatedAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  };
}

let clock = 0;
function attempt(overrides: Partial<AttemptSnapshot> = {}): AttemptSnapshot {
  clock += 1000;
  return {
    id: `attempt-${clock}`,
    status: 'VALID',
    credentialsFingerprint: FINGERPRINT,
    reason: null,
    warnings: [],
    items: [{ externalId: 'itm_1', name: 'Standard Freight', status: 'ok' }],
    startedAt: new Date(clock),
    finishedAt: new Date(clock + 100),
    ...overrides,
  };
}

describe('deriveStep', () => {
  it('sends a completed session to the terminal LIVE view', () => {
    const completed = session({ status: 'COMPLETED', completedAt: new Date() });
    expect(deriveStep(completed, [attempt()])).toBe('LIVE');
  });

  it('starts a fresh session on DETAILS', () => {
    const fresh = session({
      companyName: null,
      providerAccountId: null,
      apiKey: null,
      credentialsFingerprint: null,
    });
    expect(deriveStep(fresh, [])).toBe('DETAILS');
  });

  it('moves to VALIDATE once credentials exist but nothing has been validated', () => {
    expect(deriveStep(session(), [])).toBe('VALIDATE');
  });

  it('holds on VALIDATE while an attempt is still running', () => {
    expect(deriveStep(session(), [attempt({ status: 'RUNNING', finishedAt: null })])).toBe(
      'VALIDATE',
    );
  });

  it('advances to REVIEW on a valid result', () => {
    expect(deriveStep(session(), [attempt({ status: 'VALID' })])).toBe('REVIEW');
  });

  it('advances to REVIEW on a partial result, so the partner can decide', () => {
    const partial = attempt({ status: 'PARTIAL', warnings: ['1 item could not be imported'] });
    expect(deriveStep(session(), [partial])).toBe('REVIEW');
  });

  it('holds on VALIDATE when the provider rejected the credentials', () => {
    const invalid = attempt({ status: 'INVALID', reason: 'Unknown account', items: [] });
    expect(deriveStep(session(), [invalid])).toBe('VALIDATE');
  });

  it('holds on VALIDATE when the only attempt failed transiently', () => {
    const transient = attempt({ status: 'TRANSIENT_FAILURE', reason: 'timeout', items: [] });
    expect(deriveStep(session(), [transient])).toBe('VALIDATE');
  });

  // The credential-change guard. A stale VALID must never carry across an edit.
  it('drops back to VALIDATE when credentials changed since the last valid result', () => {
    const stale = attempt({ status: 'VALID', credentialsFingerprint: OLD_FINGERPRINT });
    expect(deriveStep(session(), [stale])).toBe('VALIDATE');
  });
});

describe('findEffectiveValidation', () => {
  it('ignores attempts that tested different credentials', () => {
    const stale = attempt({ status: 'VALID', credentialsFingerprint: OLD_FINGERPRINT });
    expect(findEffectiveValidation(session(), [stale])).toBeNull();
  });

  // The core "a transient 503 must not corrupt state" guarantee: a failed retry
  // is not an answer from the Provider, so it cannot revoke an earlier answer.
  it('keeps an earlier valid result when a later retry fails transiently', () => {
    const good = attempt({ status: 'VALID' });
    const retry = attempt({ status: 'TRANSIENT_FAILURE', reason: '503', items: [] });

    const effective = findEffectiveValidation(session(), [retry, good]);

    expect(effective?.id).toBe(good.id);
    expect(effective?.status).toBe('VALID');
  });

  // ...but an INVALID *is* an answer, and must revoke it.
  it('discards an earlier valid result once the provider reports the credentials invalid', () => {
    const good = attempt({ status: 'VALID' });
    const revoked = attempt({ status: 'INVALID', reason: 'Key revoked', items: [] });

    expect(findEffectiveValidation(session(), [revoked, good])).toBeNull();
  });

  it('ignores a running attempt and keeps the previous result visible', () => {
    const good = attempt({ status: 'VALID' });
    const running = attempt({ status: 'RUNNING', finishedAt: null, items: [] });

    expect(findEffectiveValidation(session(), [running, good])?.id).toBe(good.id);
  });

  it('prefers the most recent decisive attempt regardless of input order', () => {
    const older = attempt({ status: 'PARTIAL', warnings: ['old'] });
    const newer = attempt({ status: 'VALID' });

    expect(findEffectiveValidation(session(), [older, newer])?.id).toBe(newer.id);
    expect(findEffectiveValidation(session(), [newer, older])?.id).toBe(newer.id);
  });
});

describe('buildSessionView', () => {
  it('never exposes the raw api key, only a masked form', () => {
    const view = buildSessionView(session({ apiKey: 'sk_live_9876543210' }), []);

    expect(JSON.stringify(view)).not.toContain('sk_live_9876543210');
    expect(view.apiKeyMasked).toBe('••••3210');
    expect(view.hasApiKey).toBe(true);
  });

  it('masks a short api key entirely rather than leaking most of it', () => {
    const view = buildSessionView(session({ apiKey: 'abc' }), []);

    expect(view.apiKeyMasked).toBe('••••');
    expect(JSON.stringify(view)).not.toContain('abc');
  });

  it('reports no api key on a fresh session', () => {
    const view = buildSessionView(session({ apiKey: null, credentialsFingerprint: null }), []);

    expect(view.hasApiKey).toBe(false);
    expect(view.apiKeyMasked).toBeNull();
  });

  it('surfaces the latest attempt for status display and flags stale credentials', () => {
    const stale = attempt({ status: 'INVALID', credentialsFingerprint: OLD_FINGERPRINT });
    const view = buildSessionView(session(), [stale]);

    expect(view.latestAttempt?.id).toBe(stale.id);
    expect(view.latestAttempt?.matchesCurrentCredentials).toBe(false);
    expect(view.effectiveValidation).toBeNull();
  });

  it('exposes the effective result items for the review step', () => {
    const good = attempt({
      status: 'PARTIAL',
      warnings: ['1 item skipped'],
      items: [{ externalId: 'itm_9', name: 'Express', status: 'ok' }],
    });

    const view = buildSessionView(session(), [good]);

    expect(view.step).toBe('REVIEW');
    expect(view.effectiveValidation?.items).toEqual([
      { externalId: 'itm_9', name: 'Express', status: 'ok' },
    ]);
    expect(view.effectiveValidation?.warnings).toEqual(['1 item skipped']);
    expect(view.requiresWarningAck).toBe(true);
    expect(view.canGoLive).toBe(true);
  });

  it('does not require a warning acknowledgement for a fully valid result', () => {
    const view = buildSessionView(session(), [attempt({ status: 'VALID' })]);

    expect(view.requiresWarningAck).toBe(false);
    expect(view.canGoLive).toBe(true);
  });

  it('refuses to go live without an effective result', () => {
    const view = buildSessionView(session(), []);
    expect(view.canGoLive).toBe(false);
  });

  it('refuses to go live again once completed', () => {
    const completed = session({ status: 'COMPLETED', completedAt: new Date() });
    const view = buildSessionView(completed, [attempt({ status: 'VALID' })]);

    expect(view.step).toBe('LIVE');
    expect(view.canGoLive).toBe(false);
  });
});
