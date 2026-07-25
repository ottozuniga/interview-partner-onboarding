import type {
  CompleteRequest,
  SaveDetailsRequest,
  SessionView,
  ValidateResponse,
} from '@onboarding/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

const SESSION_KEY = ['session'] as const;

/**
 * The session is the single source of truth for the whole wizard, so every
 * mutation simply writes the returned view back into the cache. Nothing about
 * "which step am I on" lives in React state — that is what makes reload,
 * incognito, and a server restart resume correctly for free.
 */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: api.getSession,
    // Validation runs in the background on the server, so poll while an
    // attempt is in flight and stop as soon as it settles.
    refetchInterval: (query) =>
      query.state.data?.latestAttempt?.status === 'RUNNING' ? 500 : false,
    refetchOnWindowFocus: true,
  });
}

function useSessionMutation<TArgs>(mutationFn: (args: TArgs) => Promise<SessionView>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (view) => queryClient.setQueryData(SESSION_KEY, view),
  });
}

export function useSaveDetails() {
  return useSessionMutation((body: SaveDetailsRequest) => api.saveDetails(body));
}

export function useGoLive() {
  return useSessionMutation((body: CompleteRequest) => api.complete(body));
}

/**
 * Starting a validation returns the attempt, not the session, so the session
 * is refetched to pick up the RUNNING state and begin polling.
 */
export function useStartValidation() {
  const queryClient = useQueryClient();

  return useMutation<ValidateResponse, Error, boolean>({
    mutationFn: (revalidate: boolean) => api.validate(revalidate),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
  });
}
