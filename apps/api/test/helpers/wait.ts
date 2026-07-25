import type { SessionView } from '@onboarding/contracts';
import type { Test } from 'supertest';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validation is asynchronous, so tests poll the session exactly as the browser
 * does rather than reaching into internals to await a promise.
 */
export async function waitForSettledAttempt(
  getSession: () => Test,
  timeoutMs = 5000,
): Promise<SessionView> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const view = (await getSession().expect(200)).body as SessionView;

    if (view.latestAttempt && view.latestAttempt.status !== 'RUNNING') {
      return view;
    }

    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for the attempt to settle. Latest: ${JSON.stringify(view.latestAttempt)}`,
      );
    }

    await sleep(10);
  }
}
