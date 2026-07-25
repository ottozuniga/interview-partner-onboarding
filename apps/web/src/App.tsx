import { useEffect, useState } from 'react';

/**
 * Phase 0 placeholder. Its only job is to prove the Vite dev proxy reaches the
 * API. The onboarding wizard replaces this in Phase 4.
 */
export function App() {
  const [health, setHealth] = useState<string>('checking…');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((body: { status: string; database: string }) =>
        setHealth(`api: ${body.status} · database: ${body.database}`),
      )
      .catch((error: unknown) => setHealth(`unreachable (${String(error)})`));
  }, []);

  return (
    <main>
      <h1>Partner Onboarding</h1>
      <p>{health}</p>
    </main>
  );
}
