import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Wizard } from './components/Wizard';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 0 },
    // Every mutation here is either idempotent or explicitly guarded on the
    // server, but retrying automatically would still hide failures from the
    // partner rather than letting them decide.
    mutations: { retry: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <main>
        <header>
          <h1>Partner onboarding</h1>
          <p className="muted">
            Your progress is saved on the server — you can close this page and come back at any
            point.
          </p>
        </header>
        <Wizard />
      </main>
    </QueryClientProvider>
  );
}
