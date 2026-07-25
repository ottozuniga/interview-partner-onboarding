import type { SessionView } from '@onboarding/contracts';
import { useState } from 'react';
import { ApiError } from '../api/client';
import { useGoLive, useStartValidation } from '../api/use-session';
import { Alert } from './Alert';

export function ReviewStep({
  session,
  onEditDetails,
}: {
  session: SessionView;
  onEditDetails: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const goLive = useGoLive();
  const recheck = useStartValidation();

  const validation = session.effectiveValidation;
  if (!validation) {
    return null;
  }

  const blockedByWarnings = session.requiresWarningAck && !acknowledged;
  const goLiveError = goLive.error instanceof ApiError ? goLive.error : null;
  // A failed retry does not revoke the result above, so it is reported as a
  // notice rather than replacing the review.
  const staleAttempt =
    session.latestAttempt?.status === 'TRANSIENT_FAILURE' ? session.latestAttempt : null;

  return (
    <section>
      <h2>Review and go live</h2>
      <p className="muted">Here is what we found with your credentials.</p>

      <dl className="summary">
        <dt>Company</dt>
        <dd>{session.companyName}</dd>
        <dt>Account ID</dt>
        <dd>
          <code>{session.providerAccountId}</code>
        </dd>
      </dl>

      <h3>
        Items found <span className="muted">({validation.items.length})</span>
      </h3>
      {validation.items.length === 0 ? (
        <p className="muted">The Provider returned no items for this account.</p>
      ) : (
        <ul className="items">
          {validation.items.map((item) => (
            <li key={item.externalId}>
              <span>{item.name}</span>
              <code className="muted">{item.externalId}</code>
              <span className={item.status === 'ok' ? 'tag tag-ok' : 'tag tag-failed'}>
                {item.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      {validation.warnings.length > 0 && (
        <Alert tone="warning" title="Some items need attention">
          <ul>
            {validation.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            I understand and want to go live anyway
          </label>
        </Alert>
      )}

      {staleAttempt && (
        <Alert tone="warning" title="The most recent re-check could not reach the Provider">
          The results above are from your last successful check and are still valid.
        </Alert>
      )}

      {goLiveError && <Alert tone="error" title={goLiveError.message} />}

      <div className="actions">
        <button
          type="button"
          disabled={blockedByWarnings || goLive.isPending}
          onClick={() => goLive.mutate({ acknowledgedWarnings: acknowledged })}
        >
          {goLive.isPending ? 'Going live…' : 'Go live'}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={recheck.isPending}
          onClick={() => recheck.mutate(true)}
        >
          Check again
        </button>
        <button type="button" className="secondary" onClick={onEditDetails}>
          Edit details
        </button>
      </div>
    </section>
  );
}
