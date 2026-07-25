import type { SessionView } from '@onboarding/contracts';
import { ApiError } from '../api/client';
import { useStartValidation } from '../api/use-session';
import { Alert } from './Alert';

/**
 * A settled result for the *current* credentials means the Provider has
 * already answered. Asking again is then a deliberate re-check, and has to say
 * so — otherwise the server would quite correctly hand back the same cached
 * answer and the button would look broken.
 */
function needsExplicitRevalidation(session: SessionView): boolean {
  const attempt = session.latestAttempt;
  return Boolean(
    attempt && attempt.status !== 'RUNNING' && attempt.matchesCurrentCredentials,
  );
}

export function ValidateStep({ session, onEditDetails }: { session: SessionView; onEditDetails: () => void }) {
  const start = useStartValidation();
  const attempt = session.latestAttempt;
  const isRunning = attempt?.status === 'RUNNING';
  const relevant = attempt?.matchesCurrentCredentials ? attempt : null;

  const startError = start.error instanceof ApiError ? start.error : null;

  return (
    <section>
      <h2>Validate your integration</h2>
      <p className="muted">
        We will call the Provider with your credentials and pull back the items available to you.
      </p>

      <dl className="summary">
        <dt>Company</dt>
        <dd>{session.companyName}</dd>
        <dt>Account ID</dt>
        <dd>
          <code>{session.providerAccountId}</code>
        </dd>
        <dt>API key</dt>
        <dd>
          <code>{session.apiKeyMasked}</code>
        </dd>
      </dl>

      {isRunning && (
        <Alert tone="info" title="Checking with the Provider…">
          This usually takes a moment. You can safely leave this page and come back.
        </Alert>
      )}

      {!isRunning && relevant?.status === 'INVALID' && (
        <Alert tone="error" title="Those credentials were rejected">
          {relevant.reason}
        </Alert>
      )}

      {!isRunning && relevant?.status === 'TRANSIENT_FAILURE' && (
        <Alert tone="warning" title="The Provider could not be reached">
          {/* The reason comes from the Provider and has no guaranteed
              punctuation, so it gets its own line rather than being run
              together with our own sentence. */}
          <p>{relevant.reason}</p>
          <p>Nothing was changed, so it is safe to try again.</p>
        </Alert>
      )}

      {startError && <Alert tone="error" title={startError.message} />}

      <div className="actions">
        <button
          type="button"
          disabled={isRunning || start.isPending}
          onClick={() => start.mutate(needsExplicitRevalidation(session))}
        >
          {isRunning ? 'Validating…' : relevant ? 'Try again' : 'Validate'}
        </button>
        <button type="button" className="secondary" onClick={onEditDetails} disabled={isRunning}>
          Edit details
        </button>
      </div>
    </section>
  );
}
