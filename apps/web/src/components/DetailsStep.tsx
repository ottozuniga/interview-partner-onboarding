import { zodResolver } from '@hookform/resolvers/zod';
import type { SessionView } from '@onboarding/contracts';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError } from '../api/client';
import { useSaveDetails } from '../api/use-session';
import { Alert } from './Alert';

/**
 * The api key field is always a string here — a text input has no way to
 * express "absent". It is only *required* when the session has no stored key;
 * otherwise blank means "keep the saved one", which the submit handler turns
 * into an omitted field. Without that, the partner could never correct a typo
 * in their company name without retyping a secret the server will not show them.
 */
function formSchema(hasApiKey: boolean) {
  return z.object({
    companyName: z.string().trim().min(1, 'Company name is required').max(200),
    accountId: z.string().trim().min(1, 'Provider account ID is required').max(200),
    apiKey: z
      .string()
      .trim()
      .max(500)
      .refine((value) => hasApiKey || value.length > 0, {
        message: 'Provider API key is required',
      }),
  });
}

export function DetailsStep({
  session,
  onSaved,
}: {
  session: SessionView;
  onSaved?: () => void;
}) {
  const save = useSaveDetails();
  const schema = formSchema(session.hasApiKey);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      companyName: session.companyName ?? '',
      accountId: session.providerAccountId ?? '',
      apiKey: '',
    },
  });

  const serverError = save.error instanceof ApiError ? save.error : null;

  return (
    <section>
      <h2>Your details</h2>
      <p className="muted">
        Enter your company name and the Provider credentials we should use to connect.
      </p>

      {serverError && <Alert tone="error" title={serverError.message} />}

      <form
        onSubmit={handleSubmit((values) =>
          save.mutate(
            { ...values, apiKey: values.apiKey === '' ? undefined : values.apiKey },
            { onSuccess: () => onSaved?.() },
          ),
        )}
        noValidate
      >
        <label htmlFor="companyName">Company name</label>
        <input id="companyName" {...register('companyName')} autoComplete="organization" />
        {errors.companyName && <p className="field-error">{errors.companyName.message}</p>}

        <label htmlFor="accountId">Provider account ID</label>
        <input id="accountId" {...register('accountId')} autoComplete="off" spellCheck={false} />
        {errors.accountId && <p className="field-error">{errors.accountId.message}</p>}

        <label htmlFor="apiKey">Provider API key</label>
        <input
          id="apiKey"
          type="password"
          autoComplete="off"
          placeholder={session.hasApiKey ? `${session.apiKeyMasked} — leave blank to keep` : ''}
          {...register('apiKey')}
        />
        {errors.apiKey && <p className="field-error">{errors.apiKey.message}</p>}
        {session.hasApiKey && (
          <p className="hint">
            A key is already saved. Leave this blank unless you want to replace it.
          </p>
        )}

        <button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save and continue'}
        </button>
      </form>
    </section>
  );
}
