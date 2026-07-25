import {
  sessionViewSchema,
  validateResponseSchema,
  type CompleteRequest,
  type SaveDetailsRequest,
  type SessionView,
  type ValidateResponse,
} from '@onboarding/contracts';
import type { ZodSchema } from 'zod';

/** An error the API answered with deliberately, carrying a message worth showing. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: { field: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiErrorBody {
  message?: string | string[];
  errors?: { field: string; message: string }[];
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Non-JSON error (proxy failure, crash). Fall through to a generic message.
  }

  const message = Array.isArray(body.message)
    ? body.message.join(' ')
    : (body.message ?? `Request failed (${response.status})`);

  return new ApiError(response.status, message, body.errors ?? []);
}

async function send<T>(
  path: string,
  schema: ZodSchema<T>,
  init?: { method: string; body?: unknown },
): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  // Parsed with the same schema the server validates against, so a contract
  // drift fails loudly here instead of as a confusing render further down.
  return schema.parse(await response.json());
}

const SESSION = '/api/onboarding/session';

export const api = {
  getSession: () => send(SESSION, sessionViewSchema),

  saveDetails: (body: SaveDetailsRequest): Promise<SessionView> =>
    send(`${SESSION}/details`, sessionViewSchema, { method: 'PUT', body }),

  validate: (revalidate = false): Promise<ValidateResponse> =>
    send(`${SESSION}/validate`, validateResponseSchema, {
      method: 'POST',
      body: { revalidate },
    }),

  complete: (body: CompleteRequest): Promise<SessionView> =>
    send(`${SESSION}/complete`, sessionViewSchema, { method: 'POST', body }),

  /** Demo helper — see the README. */
  reset: (): Promise<SessionView> =>
    send(`${SESSION}/reset`, sessionViewSchema, { method: 'POST', body: {} }),
};
