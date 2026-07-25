import type { SessionView } from '@onboarding/contracts';
import { useResetSession } from '../api/use-session';

export function LiveStep({ session }: { session: SessionView }) {
  const reset = useResetSession();

  return (
    <>
      <section className="live">
        <h2>You&rsquo;re live</h2>
        <p className="live-subtitle">
          {session.companyName ? `${session.companyName} is connected` : 'Company is connected'}
        </p>
      </section>

      {/* Not a product feature — it exists so the flow can be walked again
          with different Provider credentials. See the README. */}
      <p className="demo-reset">
        <button
          type="button"
          className="secondary"
          disabled={reset.isPending}
          onClick={() => reset.mutate(undefined)}
        >
          {reset.isPending ? 'Starting over…' : 'Start over (demo)'}
        </button>
      </p>
    </>
  );
}
