import type { SessionView } from '@onboarding/contracts';

export function LiveStep({ session }: { session: SessionView }) {
  return (
    <section className="live">
      <h2>You&rsquo;re live</h2>
      <p className="live-subtitle">
        {session.companyName ? `${session.companyName} is connected` : 'Company is connected'}
      </p>
    </section>
  );
}
