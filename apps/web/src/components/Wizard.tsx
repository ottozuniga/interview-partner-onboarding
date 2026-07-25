import { useState } from 'react';
import { useSession } from '../api/use-session';
import { Alert } from './Alert';
import { DetailsStep } from './DetailsStep';
import { LiveStep } from './LiveStep';
import { ReviewStep } from './ReviewStep';
import { Stepper } from './Stepper';
import { ValidateStep } from './ValidateStep';

export function Wizard() {
  const { data: session, isPending, error, refetch } = useSession();

  /**
   * The only piece of client state in the wizard, and deliberately not
   * progress: it is a transient "I want to go back and change something"
   * request. Progress itself always comes from the server, which is why a
   * reload lands on the right step whatever this happens to be.
   */
  const [editingDetails, setEditingDetails] = useState(false);

  if (isPending) {
    return <p className="muted">Loading your onboarding session…</p>;
  }

  if (error || !session) {
    return (
      <Alert tone="error" title="Could not load your onboarding session">
        <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        <button type="button" onClick={() => void refetch()}>
          Try again
        </button>
      </Alert>
    );
  }

  const step = editingDetails && session.status === 'IN_PROGRESS' ? 'DETAILS' : session.step;

  return (
    <>
      <Stepper current={step} />

      {step === 'DETAILS' && (
        <DetailsStep session={session} onSaved={() => setEditingDetails(false)} />
      )}
      {step === 'VALIDATE' && (
        <ValidateStep session={session} onEditDetails={() => setEditingDetails(true)} />
      )}
      {step === 'REVIEW' && (
        <ReviewStep session={session} onEditDetails={() => setEditingDetails(true)} />
      )}
      {step === 'LIVE' && <LiveStep session={session} />}
    </>
  );
}
