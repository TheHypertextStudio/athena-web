'use client';

/**
 * Settings → Athena → "Call Athena": binding a phone number to the account.
 *
 * @remarks
 * ## Why the country is a control and not a prefix you type
 *
 * A phone number typed without a country is ambiguous at the switch, and this number is a
 * credential — an inbound call is matched against it exactly. So the form has a country selector
 * and a national number field, and the API composes E.164 from the pair. There is no way to submit
 * a raw string.
 *
 * ## The number is never shown back
 *
 * Once bound, the row shows the country code and the last two digits. A read of your settings is
 * not a directory of your phone numbers, even to you — because a stolen session should not become
 * one either.
 *
 * ## Verification state is never implied
 *
 * A number reads "Waiting for the code" until a code you received comes back. The section states
 * the real limits (how long the code lasts, how many tries remain) rather than letting a person
 * discover them by being locked out.
 *
 * Those limits, and the code box itself, are read off the server's own rows rather than remembered
 * from the request that started the verification. That distinction is the whole design: this
 * section used to gate the code box on local state set by the `POST` that sent the code, so
 * reloading the page — or opening settings on the handset the code was texted to — left a row
 * reading "Waiting for the code" with nowhere to type it, and the only remaining control was a
 * resend the rate limiter refuses. A code that exists on the server is always enterable here.
 */
import { DEFAULT_DIAL_CODE, SUPPORTED_PHONE_COUNTRIES } from '@docket/athena/phone';
import type {
  PhoneCallOut,
  PhoneChallengeOut,
  PhoneNumberListOut,
  PhoneNumberOut,
  PhoneNumberStatus,
} from '@docket/athena/phone';
import { Check, Phone, PhoneOff, Trash2 } from '@docket/ui/icons';
import {
  Badge,
  Button,
  ControlGroup,
  Field,
  Input,
  Select,
  Skeleton,
  Surface,
  Text,
} from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { SettingsGroup } from '@/components/settings/settings-group';
import { SETTINGS_NODES } from '@/components/settings/settings-capabilities';
import { useReauth } from '@/components/settings/use-reauth';
import { ConfirmDestructiveDialog } from '@docket/ui/components';

import { api } from '@/lib/api';
import { formatClock } from '@/lib/format-time';
import { UserFacingError, userErrorMessage } from '@/lib/problem';
import {
  apiQueryOptions,
  queryKeys,
  type RpcResponse,
  seedListItem,
  unwrap,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';

/** The country preselected when nothing has been bound yet. */
const DEFAULT_COUNTRY = 'US';

/** What each lifecycle state is called here. Application-owned copy, one label per state. */
const STATUS_LABEL: Record<PhoneNumberStatus, string> = {
  pending: 'Waiting for the code',
  verified: 'Verified',
  blocked: 'Not usable',
};

/**
 * Which number the code box is pointed at.
 *
 * @remarks
 * `auto` is the default and carries the fix: it resolves against the server's pending rows every
 * render, so a code that exists is always enterable, including in a session that did not request
 * it. `number` pins the box to one row — the number just bound, or the one picked out of two
 * pending. `add` is the deliberate escape to bind a *different* number while one is still pending.
 */
type CodeTarget =
  | { readonly kind: 'auto' }
  | { readonly kind: 'number'; readonly id: string }
  | { readonly kind: 'add' };

/** When this number's resend button should come back, or `Infinity` if it was never disabled. */
function cooldownEnd(number: PhoneNumberOut): number {
  return number.challenge ? Date.parse(number.challenge.resendAvailableAt) : Infinity;
}

/** Shown when the transport could not deliver a code, whoever asked for it. */
const UNDELIVERED_MESSAGE = 'We couldn’t deliver the code to that number. Check it and try again.';

/** Format the public Athena destination without exposing a linked caller number. */
function formatDestination(e164: string): string {
  const northAmerican = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return northAmerican ? `+1 ${northAmerican[1]} ${northAmerican[2]} ${northAmerican[3]}` : e164;
}

/** The country selector's options. Static data, so built once rather than per render. */
const COUNTRY_OPTIONS = SUPPORTED_PHONE_COUNTRIES.map((option) => (
  <option key={option.iso2} value={option.iso2}>
    {option.name} +{option.dialCode}
  </option>
));

/**
 * The caller-owned phone numbers section.
 *
 * @remarks
 * Rendered inside Settings → Athena because a bound number is part of how Athena knows you, not a
 * notification destination. The two are separate on purpose: ticking "text me about mentions"
 * must never also authorize whoever holds that handset to open your conversation.
 */
export function VoicePhoneNumbers(): JSX.Element {
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [nationalNumber, setNationalNumber] = useState('');
  const [code, setCode] = useState('');
  const [target, setTarget] = useState<CodeTarget>({ kind: 'auto' });
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PhoneNumberOut | null>(null);
  const queryClient = useQueryClient();
  const reauth = useReauth();

  const dialCode = useMemo(
    () =>
      SUPPORTED_PHONE_COUNTRIES.find((option) => option.iso2 === country)?.dialCode ??
      DEFAULT_DIAL_CODE,
    [country],
  );

  const numbersQ = useApiQuery(
    apiQueryOptions<PhoneNumberListOut>(
      queryKeys.phoneNumbers(),
      () => api.v1.me['phone-numbers'].$get(),
      'Could not load your phone numbers.',
    ),
  );

  /** Retry a sensitive request after passkey step-up only when its current session is stale. */
  const withFreshSession = async <T,>(
    request: () => Promise<RpcResponse<T>>,
    fallback: string,
  ): Promise<T> => {
    try {
      return await unwrap(request, fallback);
    } catch (error) {
      if (!(error instanceof UserFacingError) || error.code !== 'reauth_required') throw error;
      await reauth();
      return unwrap(request, fallback);
    }
  };

  /**
   * Aim the code box somewhere and clear what belonged to where it was.
   *
   * @remarks
   * One helper rather than a reset at each call site: the digits typed for one number and the error
   * raised by one attempt are both meaningless against the next target, and spelling that out
   * seven times is how they end up diverging.
   */
  const pointAt = (next: CodeTarget): void => {
    setTarget(next);
    setCode('');
    setNotice(null);
  };

  /**
   * Record a freshly issued challenge and point the code box at the number it belongs to.
   *
   * @remarks
   * `bind` invalidates the list rather than awaiting it, so for one round trip the server has not
   * yet reported the row this person is holding a code for. The section reads everything off that
   * list, so the server's own answer goes into it rather than into a state slot beside it.
   */
  const acceptChallenge = (result: PhoneChallengeOut): void => {
    seedListItem(queryClient, queryKeys.phoneNumbers(), result.phoneNumber);
    pointAt({ kind: 'number', id: result.phoneNumber.id });
  };

  const bind = useApiMutation<PhoneChallengeOut, undefined>({
    mutationFn: () =>
      withFreshSession<PhoneChallengeOut>(
        () =>
          api.v1.me['phone-numbers'].$post({
            json: { country, dialCode, nationalNumber },
          }),
        'Could not send the code.',
      ),
    invalidateKeys: [queryKeys.phoneNumbers()],
    onSuccess: (result) => {
      acceptChallenge(result);
      setNationalNumber('');
      setConfirmation('Docket sent a verification code.');
    },
    onError: (error) => {
      setNotice(userErrorMessage(error, 'Could not send the code.'));
    },
  });

  const verify = useApiMutation<PhoneNumberOut, string>({
    mutationFn: (id) =>
      withFreshSession<PhoneNumberOut>(
        () => api.v1.me['phone-numbers'][':id'].verify.$post({ param: { id }, json: { code } }),
        'That code didn’t work.',
      ),
    invalidateKeys: [queryKeys.phoneNumbers()],
    onSuccess: () => {
      pointAt({ kind: 'auto' });
      setConfirmation('Your phone number is verified.');
    },
    onError: (error) => {
      setNotice(
        userErrorMessage(
          error,
          error instanceof UserFacingError && error.status === 503
            ? 'Docket could not check that code. Try again.'
            : 'That code didn’t work.',
        ),
      );
    },
  });

  const resend = useApiMutation<PhoneChallengeOut, string>({
    mutationFn: (id) =>
      unwrap(
        () => api.v1.me['phone-numbers'][':id'].resend.$post({ param: { id } }),
        'Could not send another code.',
      ),
    // The new code resets this number's expiry, tries, and cooldown — all of which now live on the
    // listed row, so the list has to be refetched for the section to stop describing the old code.
    invalidateKeys: [queryKeys.phoneNumbers()],
    onSuccess: acceptChallenge,
    onError: (error) => {
      setNotice(userErrorMessage(error, 'Could not send another code.'));
    },
  });

  const calling = useApiMutation<
    PhoneNumberOut,
    { readonly id: string; readonly enabled: boolean }
  >({
    mutationFn: ({ id, enabled }) => {
      const request = (): Promise<RpcResponse<PhoneNumberOut>> =>
        api.v1.me['phone-numbers'][':id'].calling.$post({
          param: { id },
          json: { enabled },
        });
      return enabled
        ? withFreshSession<PhoneNumberOut>(request, 'Could not enable phone calls.')
        : unwrap(request, 'Could not pause phone calls.');
    },
    invalidateKeys: [queryKeys.phoneNumbers()],
    onSuccess: (result, input) => {
      setConfirmation(input.enabled ? 'Athena calls are enabled.' : 'Athena calls are paused.');
      seedListItem(queryClient, queryKeys.phoneNumbers(), result);
    },
    onError: (error) => {
      setNotice(userErrorMessage(error, 'Could not change phone calling.'));
    },
  });

  const call = useApiMutation<PhoneCallOut, string>({
    mutationFn: (id) =>
      unwrap(
        () => api.v1.me['phone-numbers'][':id'].call.$post({ param: { id } }),
        'Could not start the call.',
      ),
    invalidateKeys: [queryKeys.phoneNumbers()],
    onSuccess: () => {
      setNotice(null);
      setConfirmation('Athena is calling your verified number. Press 1 when asked to connect.');
    },
    onError: (error) => {
      setConfirmation(null);
      setNotice(userErrorMessage(error, 'Could not start the call.'));
    },
  });

  const remove = useApiMutation<PhoneNumberOut, string>({
    mutationFn: (id) =>
      withFreshSession<PhoneNumberOut>(
        () => api.v1.me['phone-numbers'][':id'].$delete({ param: { id } }),
        'Could not remove that number.',
      ),
    invalidateKeys: [queryKeys.phoneNumbers()],
    onSuccess: () => {
      pointAt({ kind: 'auto' });
      setRemoveTarget(null);
      setConfirmation('The phone number was removed.');
    },
    onError: (error) => {
      setNotice(userErrorMessage(error, 'Could not remove that number.'));
    },
  });

  const items = numbersQ.data?.items ?? [];

  /** Every number that can take a code right now. The cached list is the only source. */
  const verifiable = items.filter((number) => number.status === 'pending');

  const verifying =
    target.kind === 'add'
      ? null
      : target.kind === 'number'
        ? (verifiable.find((number) => number.id === target.id) ?? null)
        : (verifiable[0] ?? null);

  const challenge = verifying?.challenge ?? null;

  /**
   * The wall clock, once the component is running in a browser.
   *
   * @remarks
   * Null until mounted, deliberately: seeding this from `Date.now()` during render would put the
   * server's clock and the client's into the same `disabled` attribute and mismatch on hydration.
   * Nothing reads as cooling down until a real client clock exists, which is also the honest
   * reading — a server prerender cannot know how long ago the code was sent.
   */
  const [now, setNow] = useState<number | null>(null);

  /** Whether this number's own cooldown has yet to elapse. */
  const isCoolingDown = (number: PhoneNumberOut): boolean =>
    now !== null && cooldownEnd(number) > now;

  // The soonest moment any row's button should come back. Every pending row owns a cooldown, not
  // just the one being verified — a row the code box is not pointed at is equally capable of
  // having had a code sent moments ago.
  const nextResendAt = verifiable.reduce(
    (soonest, number) => Math.min(soonest, cooldownEnd(number)),
    Infinity,
  );

  useEffect(() => {
    // Re-check exactly when the earliest cooldown expires rather than polling: the deadline is
    // already known, and nothing on screen counts down, so a once-per-second re-render of the
    // whole section would buy nothing. Runs on mount too, which is what seeds `now`.
    setNow(Date.now());
    // `Infinity` when nothing is pending, `NaN` if a row carried an unparseable timestamp: either
    // way there is no moment to wake up for.
    if (!Number.isFinite(nextResendAt)) return undefined;
    const delay = nextResendAt - Date.now();
    if (delay <= 0) return undefined;
    const timer = setTimeout(() => {
      setNow(Date.now());
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [nextResendAt]);

  // A code that was never delivered is reported whether this session sent it or read it back, so
  // the warning survives the reload that the rest of this section's state now survives.
  const alert = notice ?? (challenge?.deliveryFailed ? UNDELIVERED_MESSAGE : null);

  return (
    <SettingsGroup capability={SETTINGS_NODES.athenaPhone} data-phone-numbers-section>
      {numbersQ.isPending ? (
        <div aria-busy="true" aria-label="Loading phone numbers" className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
        </div>
      ) : null}
      {numbersQ.isError ? (
        <div role="alert" className="flex items-center justify-between gap-3">
          <Text token="body-small" tone="error">
            Could not load your phone numbers.
          </Text>
          <Button
            variant="outline"
            onClick={() => {
              void numbersQ.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {numbersQ.data ? (
        <>
          {numbersQ.data.athenaNumber ? (
            <div className="border-outline-variant flex min-w-0 flex-col gap-1 border-b pb-3">
              <Text token="body-medium">
                Call{' '}
                <a
                  className="text-primary whitespace-nowrap underline-offset-2 hover:underline"
                  data-native-navigation
                  href={`tel:${numbersQ.data.athenaNumber}`}
                >
                  {formatDestination(numbersQ.data.athenaNumber)}
                </a>
              </Text>
              <Text token="body-small" tone="muted">
                Calls your carrier can verify connect directly. Athena calls your verified number
                back when the carrier cannot verify the call.
              </Text>
            </div>
          ) : null}
          {items.length > 0 ? (
            <ul className="flex flex-col gap-2" data-phone-number-list>
              {items.map((number) => (
                <Surface
                  as="li"
                  tone="canvas"
                  shape="small"
                  pad="comfortable"
                  key={number.id}
                  className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  data-phone-number-row
                  data-phone-number-id={number.id}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="text-on-surface-variant shrink-0">
                      {number.status === 'verified' ? (
                        <Phone className="size-4.5" />
                      ) : (
                        <PhoneOff className="size-4.5" />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <Text token="body-medium" numeric className="truncate">
                        {number.masked}
                      </Text>
                      {number.lastCalledAt ? (
                        <Text token="body-small" tone="muted">
                          Last call{' '}
                          <time dateTime={number.lastCalledAt}>
                            {formatClock(number.lastCalledAt)}
                          </time>
                        </Text>
                      ) : null}
                    </span>
                    <Badge variant={number.status === 'verified' ? 'secondary' : 'outline'}>
                      {number.status === 'verified' && !number.callingEnabled
                        ? 'Calls paused'
                        : STATUS_LABEL[number.status]}
                    </Badge>
                  </div>
                  <ControlGroup controlSize="sm" className="shrink-0 flex-nowrap justify-end">
                    {/* Gated on `pending`, not on "not verified": a blocked number is refused by the
                    server, so offering it a resend would be an invitation to a guaranteed error. */}
                    {number.status === 'pending' ? (
                      <>
                        {number.id === verifying?.id ? null : (
                          <Button
                            variant="ghost"
                            data-phone-action="enter-code"
                            onClick={() => {
                              pointAt({ kind: 'number', id: number.id });
                            }}
                          >
                            Enter code
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          data-phone-action="resend"
                          disabled={resend.isPending || isCoolingDown(number)}
                          onClick={() => {
                            pointAt({ kind: 'number', id: number.id });
                            resend.mutate(number.id);
                          }}
                        >
                          Send a new code
                        </Button>
                      </>
                    ) : null}
                    {number.status === 'verified' ? (
                      <>
                        {number.callingEnabled ? (
                          <Button
                            variant="ghost"
                            data-phone-action="call"
                            disabled={call.isPending}
                            onClick={() => {
                              call.mutate(number.id);
                            }}
                          >
                            Call me
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          data-phone-action={
                            number.callingEnabled ? 'disable-calling' : 'enable-calling'
                          }
                          disabled={calling.isPending}
                          onClick={() => {
                            calling.mutate({ id: number.id, enabled: !number.callingEnabled });
                          }}
                        >
                          {number.callingEnabled ? 'Pause calls' : 'Enable calls'}
                        </Button>
                      </>
                    ) : null}
                    <Button
                      variant="ghost"
                      iconOnly
                      className="size-10"
                      data-phone-action="remove"
                      aria-label={`Remove ${number.masked}`}
                      onClick={() => {
                        setRemoveTarget(number);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </ControlGroup>
                </Surface>
              ))}
            </ul>
          ) : null}

          {verifying ? (
            <form
              className="flex flex-col gap-3"
              data-phone-verify-form
              onSubmit={(event) => {
                event.preventDefault();
                if (code.length === 6 && !verify.isPending) verify.mutate(verifying.id);
              }}
            >
              <Field
                label="Enter the 6-digit code"
                description={
                  challenge ? (
                    <>
                      We texted it to {verifying.masked}. It works until{' '}
                      <time dateTime={challenge.expiresAt}>{formatClock(challenge.expiresAt)}</time>
                      , and you have {String(challenge.attemptsRemaining)} tries.
                    </>
                  ) : (
                    <>Enter the code we texted to {verifying.masked}, or ask for a new one above.</>
                  )
                }
              >
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, ''));
                  }}
                  placeholder="000000"
                  data-phone-field="code"
                />
              </Field>
              <ControlGroup>
                <Button
                  type="submit"
                  data-phone-action="verify"
                  disabled={code.length !== 6 || verify.isPending}
                >
                  <Check aria-hidden="true" />
                  {verify.isPending ? 'Verifying…' : 'Verify'}
                </Button>
                {/* Not "Cancel": the pending number survives this, and calling it cancellation is what
                used to send people back to the add form to retype a number already on file. */}
                <Button
                  type="button"
                  variant="ghost"
                  data-phone-action="add-different"
                  onClick={() => {
                    pointAt({ kind: 'add' });
                  }}
                >
                  Add a different number
                </Button>
              </ControlGroup>
            </form>
          ) : (
            <form
              className="flex flex-col gap-3"
              data-phone-add-form
              onSubmit={(event) => {
                event.preventDefault();
                if (nationalNumber.trim().length >= 4 && !bind.isPending) bind.mutate(undefined);
              }}
            >
              <ControlGroup controlSize="lg" wrap className="items-end">
                <Field label="Country">
                  <Select
                    value={country}
                    onChange={(event) => {
                      setCountry(event.target.value);
                    }}
                    aria-label="Country calling code"
                  >
                    {COUNTRY_OPTIONS}
                  </Select>
                </Field>
                <Field label="Phone number">
                  <Input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    value={nationalNumber}
                    onChange={(event) => {
                      setNationalNumber(event.target.value);
                    }}
                    placeholder="415 555 0123"
                    data-phone-field="national-number"
                  />
                </Field>
              </ControlGroup>
              <ControlGroup>
                <Button
                  type="submit"
                  data-phone-action="bind"
                  disabled={nationalNumber.trim().length < 4 || bind.isPending}
                >
                  <Phone aria-hidden="true" />
                  {bind.isPending ? 'Sending code…' : 'Send me a code'}
                </Button>
                {verifiable.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    data-phone-action="back-to-code"
                    onClick={() => {
                      pointAt({ kind: 'auto' });
                    }}
                  >
                    Enter the code instead
                  </Button>
                ) : null}
              </ControlGroup>
            </form>
          )}

          {alert ? (
            <p role="alert" className="text-error">
              <Text token="body-small" tone="inherit">
                {alert}
              </Text>
            </p>
          ) : null}
          {confirmation ? (
            <p role="status" aria-live="polite">
              <Text token="body-small">{confirmation}</Text>
            </p>
          ) : null}
        </>
      ) : null}
      <ConfirmDestructiveDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove phone number?"
        description={
          removeTarget
            ? `Athena will stop accepting calls from ${removeTarget.masked}. Any active call will end.`
            : ''
        }
        confirmLabel="Remove phone number"
        pending={remove.isPending}
        error={removeTarget ? notice : null}
        onConfirm={() => {
          if (!removeTarget) return;
          setNotice(null);
          remove.mutate(removeTarget.id);
        }}
      />
    </SettingsGroup>
  );
}

export default VoicePhoneNumbers;
