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
  PhoneChallengeState,
  PhoneNumberListOut,
  PhoneNumberOut,
  PhoneNumberStatus,
} from '@docket/athena/phone';
import { Check, Ellipsis, Phone, PhoneOff, Trash2 } from '@docket/ui/icons';
import {
  Badge,
  Button,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  Input,
  Select,
  Skeleton,
  Surface,
  Text,
} from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useEffect, useMemo, useRef, useState } from 'react';

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
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** What each lifecycle state is called here. Application-owned copy, one label per state. */
const STATUS_LABEL: Record<PhoneNumberStatus, string> = {
  pending: 'Waiting for the code',
  verified: 'Verified',
  blocked: 'Not usable',
};

interface Feedback {
  readonly tone: 'error' | 'success';
  readonly copy: string;
}

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

/** Apply the client clock to a server state so expiry changes without a reload. */
function liveChallengeState(
  number: PhoneNumberOut,
  now: number | null,
): PhoneChallengeState | null {
  if (!number.challenge) return null;
  if (now !== null && Date.parse(number.challenge.expiresAt) <= now) return 'expired';
  return number.challenge.state;
}

function acceptsCode(state: PhoneChallengeState | null): boolean {
  return state === 'awaiting_code' || state === 'delivery_unknown';
}

/** Shown when the transport could not deliver a code, whoever asked for it. */
const STATE_MESSAGE: Partial<Record<PhoneChallengeState, Feedback>> = {
  delivery_unknown: {
    tone: 'error',
    copy: 'Delivery could not be confirmed. The code may still arrive, or you can send a new one.',
  },
  delivery_failed: {
    tone: 'error',
    copy: 'We couldn’t deliver the code to that number. Check it and send a new one.',
  },
  expired: { tone: 'error', copy: 'That code expired. Send a new one to continue.' },
  attempts_exhausted: {
    tone: 'error',
    copy: 'That code used all of its tries. Send a new one to continue.',
  },
};

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

function phoneStatusLabel(number: PhoneNumberOut, now: number | null): string {
  if (number.status === 'verified' && !number.callingEnabled) return 'Calls paused';
  if (number.status !== 'pending' || !number.challenge) return STATUS_LABEL[number.status];
  const state = liveChallengeState(number, now) ?? 'awaiting_code';
  return {
    awaiting_code: 'Code sent',
    delivery_unknown: 'Delivery unknown',
    delivery_failed: 'Send failed',
    expired: 'Expired',
    attempts_exhausted: 'Tries used',
  }[state];
}

interface PhoneNumberRowViewProps {
  readonly number: PhoneNumberOut;
  readonly now: number | null;
  readonly verifyingId: string | null;
  readonly coolingDown: boolean;
  readonly resendPending: boolean;
  readonly callingPending: boolean;
  readonly callPending: boolean;
  readonly onEnterCode: () => void;
  readonly onResend: () => void;
  readonly onCall: () => void;
  readonly onToggleCalling: () => void;
  readonly onRemove: () => void;
}

function PhoneNumberRowView({
  number,
  now,
  verifyingId,
  coolingDown,
  resendPending,
  callingPending,
  callPending,
  onEnterCode,
  onResend,
  onCall,
  onToggleCalling,
  onRemove,
}: PhoneNumberRowViewProps): JSX.Element {
  const challengeState = liveChallengeState(number, now);
  return (
    <Surface
      as="li"
      tone="canvas"
      shape="small"
      pad="comfortable"
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
              <time dateTime={number.lastCalledAt}>{formatClock(number.lastCalledAt)}</time>
            </Text>
          ) : null}
        </span>
        <Badge variant={number.status === 'verified' ? 'secondary' : 'outline'}>
          {phoneStatusLabel(number, now)}
        </Badge>
      </div>
      <ControlGroup controlSize="sm" className="shrink-0 flex-nowrap justify-end">
        {number.status === 'pending' ? (
          <>
            {acceptsCode(challengeState) && number.id !== verifyingId ? (
              <Button variant="ghost" data-phone-action="enter-code" onClick={onEnterCode}>
                Enter code
              </Button>
            ) : null}
            <Button
              variant="ghost"
              data-phone-action="resend"
              disabled={resendPending || coolingDown}
              onClick={onResend}
            >
              {acceptsCode(challengeState) ? 'Send a new code' : 'Try a new code'}
            </Button>
          </>
        ) : null}
        {number.status === 'verified' ? (
          <>
            {number.callingEnabled ? (
              <Button
                variant="ghost"
                data-phone-action="call"
                disabled={callPending}
                onClick={onCall}
              >
                Call me
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className="hidden sm:inline-flex"
              data-phone-action={number.callingEnabled ? 'disable-calling' : 'enable-calling'}
              disabled={callingPending}
              onClick={onToggleCalling}
            >
              {number.callingEnabled ? 'Pause calls' : 'Enable calls'}
            </Button>
          </>
        ) : null}
        <Button
          variant="ghost"
          iconOnly
          className="hidden size-10 sm:inline-flex"
          data-phone-action="remove"
          aria-label={`Remove ${number.masked}`}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              iconOnly
              className="size-10 sm:hidden"
              data-phone-action="more"
              aria-label={`More options for ${number.masked}`}
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {number.status === 'verified' ? (
              <DropdownMenuItem disabled={callingPending} onSelect={onToggleCalling}>
                {number.callingEnabled ? 'Pause calls' : 'Enable calls'}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem destructive onSelect={onRemove}>
              Remove number
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ControlGroup>
    </Surface>
  );
}

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
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PhoneNumberOut | null>(null);
  const queryClient = useQueryClient();
  const reauth = useReauth();
  const codeInputRef = useRef<HTMLInputElement>(null);

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
    setFeedback(null);
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
    onMutate: () => {
      setFeedback(null);
    },
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
      setFeedback(
        result.state === 'awaiting_code'
          ? { tone: 'success', copy: 'Docket sent a verification code.' }
          : null,
      );
    },
    onError: (error) => {
      setFeedback({ tone: 'error', copy: userErrorMessage(error, 'Could not send the code.') });
    },
  });

  const verify = useApiMutation<PhoneNumberOut, string>({
    onMutate: () => {
      setFeedback(null);
    },
    mutationFn: (id) =>
      withFreshSession<PhoneNumberOut>(
        () => api.v1.me['phone-numbers'][':id'].verify.$post({ param: { id }, json: { code } }),
        'That code didn’t work.',
      ),
    invalidateKeys: [queryKeys.phoneNumbers()],
    onSuccess: () => {
      pointAt({ kind: 'auto' });
      setFeedback({ tone: 'success', copy: 'Your phone number is verified.' });
    },
    onError: (error) => {
      setFeedback({
        tone: 'error',
        copy: userErrorMessage(
          error,
          error instanceof UserFacingError && error.status === 503
            ? 'Docket could not check that code. Try again.'
            : 'That code didn’t work.',
        ),
      });
    },
  });

  const resend = useApiMutation<PhoneChallengeOut, string>({
    onMutate: () => {
      setFeedback(null);
    },
    mutationFn: (id) =>
      unwrap(
        () => api.v1.me['phone-numbers'][':id'].resend.$post({ param: { id } }),
        'Could not send another code.',
      ),
    // The new code resets this number's expiry, tries, and cooldown — all of which now live on the
    // listed row, so the list has to be refetched for the section to stop describing the old code.
    invalidateKeys: [queryKeys.phoneNumbers()],
    onSuccess: (result) => {
      acceptChallenge(result);
      setFeedback(
        result.state === 'awaiting_code'
          ? { tone: 'success', copy: 'Docket sent a new verification code.' }
          : null,
      );
    },
    onError: (error) => {
      setFeedback({
        tone: 'error',
        copy: userErrorMessage(error, 'Could not send another code.'),
      });
    },
  });

  const calling = useApiMutation<
    PhoneNumberOut,
    { readonly id: string; readonly enabled: boolean }
  >({
    onMutate: () => {
      setFeedback(null);
    },
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
      setFeedback({
        tone: 'success',
        copy: input.enabled ? 'Athena calls are enabled.' : 'Athena calls are paused.',
      });
      seedListItem(queryClient, queryKeys.phoneNumbers(), result);
    },
    onError: (error) => {
      setFeedback({
        tone: 'error',
        copy: userErrorMessage(error, 'Could not change phone calling.'),
      });
    },
  });

  const call = useApiMutation<PhoneCallOut, string>({
    onMutate: () => {
      setFeedback(null);
    },
    mutationFn: (id) =>
      unwrap(
        () => api.v1.me['phone-numbers'][':id'].call.$post({ param: { id } }),
        'Could not start the call.',
      ),
    invalidateKeys: [queryKeys.phoneNumbers()],
    onSuccess: () => {
      setFeedback({
        tone: 'success',
        copy: 'Athena is calling your verified number. Press 1 when asked to connect.',
      });
    },
    onError: (error) => {
      setFeedback({ tone: 'error', copy: userErrorMessage(error, 'Could not start the call.') });
    },
  });

  const remove = useApiMutation<PhoneNumberOut, string>({
    onMutate: () => {
      setFeedback(null);
    },
    mutationFn: (id) =>
      withFreshSession<PhoneNumberOut>(
        () => api.v1.me['phone-numbers'][':id'].$delete({ param: { id } }),
        'Could not remove that number.',
      ),
    invalidateKeys: [queryKeys.phoneNumbers()],
    onSuccess: () => {
      pointAt({ kind: 'auto' });
      setRemoveTarget(null);
      setFeedback({ tone: 'success', copy: 'The phone number was removed.' });
    },
    onError: (error) => {
      setFeedback({
        tone: 'error',
        copy: userErrorMessage(error, 'Could not remove that number.'),
      });
    },
  });

  const [now, setNow] = useState<number | null>(null);
  const items = numbersQ.data?.items ?? [];

  /** Every number that can take a code right now. The cached list is the only source. */
  const verifiable = items.filter(
    (number) => number.status === 'pending' && acceptsCode(liveChallengeState(number, now)),
  );
  const pendingNumbers = items.filter((number) => number.status === 'pending');

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
  /** Whether this number's own cooldown has yet to elapse. */
  const isCoolingDown = (number: PhoneNumberOut): boolean =>
    now !== null && cooldownEnd(number) > now;

  // The soonest moment any row's button should come back. Every pending row owns a cooldown, not
  // just the one being verified — a row the code box is not pointed at is equally capable of
  // having had a code sent moments ago.
  const renderedAt = now ?? Date.now();
  const nextStateAt = pendingNumbers.reduce((soonest, number) => {
    const deadlines = [
      cooldownEnd(number),
      number.challenge ? Date.parse(number.challenge.expiresAt) : Infinity,
    ].filter((deadline) => deadline > renderedAt);
    return Math.min(soonest, ...deadlines);
  }, Infinity);

  useEffect(() => {
    // Re-check exactly when the earliest cooldown expires rather than polling: the deadline is
    // already known, and nothing on screen counts down, so a once-per-second re-render of the
    // whole section would buy nothing. Runs on mount too, which is what seeds `now`.
    setNow(Date.now());
    // `Infinity` when nothing is pending, `NaN` if a row carried an unparseable timestamp: either
    // way there is no moment to wake up for.
    if (!Number.isFinite(nextStateAt)) return undefined;
    const delay = nextStateAt - Date.now();
    if (delay <= 0) return undefined;
    const timer = setTimeout(
      () => {
        setNow(Date.now());
      },
      Math.min(delay, MAX_TIMER_DELAY_MS),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [nextStateAt]);

  useEffect(() => {
    if (verifying) codeInputRef.current?.focus();
  }, [verifying?.id]);

  const statefulNumber =
    verifying ?? pendingNumbers.find((number) => liveChallengeState(number, now) !== null) ?? null;
  const challengeFeedback = statefulNumber
    ? (STATE_MESSAGE[liveChallengeState(statefulNumber, now) ?? 'awaiting_code'] ?? null)
    : null;
  const visibleFeedback = feedback ?? challengeFeedback ?? null;

  const renderLoaded = (): JSX.Element | null => {
    const data = numbersQ.data;
    if (!data) return null;
    return (
      <>
        {data.athenaNumber ? (
          <div className="border-outline-variant flex min-w-0 flex-col gap-1 border-b pb-3">
            <Text token="body-medium">
              Call{' '}
              <a
                className="text-primary whitespace-nowrap underline-offset-2 hover:underline"
                data-native-navigation
                href={`tel:${data.athenaNumber}`}
              >
                {formatDestination(data.athenaNumber)}
              </a>
            </Text>
            <Text token="body-small" tone="muted">
              Calls your carrier can verify connect directly. Athena calls your verified number back
              when the carrier cannot verify the call.
            </Text>
          </div>
        ) : null}
        {items.length > 0 ? (
          <ul className="flex flex-col gap-2" data-phone-number-list>
            {items.map((number) => (
              <PhoneNumberRowView
                key={number.id}
                number={number}
                now={now}
                verifyingId={verifying?.id ?? null}
                coolingDown={isCoolingDown(number)}
                resendPending={resend.isPending}
                callingPending={calling.isPending}
                callPending={call.isPending}
                onEnterCode={() => {
                  pointAt({ kind: 'number', id: number.id });
                }}
                onResend={() => {
                  pointAt({ kind: 'number', id: number.id });
                  resend.mutate(number.id);
                }}
                onCall={() => {
                  call.mutate(number.id);
                }}
                onToggleCalling={() => {
                  calling.mutate({ id: number.id, enabled: !number.callingEnabled });
                }}
                onRemove={() => {
                  setRemoveTarget(number);
                }}
              />
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
                    {liveChallengeState(verifying, now) === 'delivery_unknown'
                      ? `A code may still arrive at ${verifying.masked}. It works until `
                      : `We texted it to ${verifying.masked}. It works until `}
                    <time dateTime={challenge.expiresAt}>{formatClock(challenge.expiresAt)}</time>,
                    and you have {String(challenge.attemptsRemaining)} tries.
                  </>
                ) : (
                  <>Enter the code we texted to {verifying.masked}, or ask for a new one above.</>
                )
              }
            >
              <Input
                ref={codeInputRef}
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
        ) : data.verification.available &&
          (target.kind === 'add' || pendingNumbers.length === 0) ? (
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
                  disabled={bind.isPending}
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
                  disabled={bind.isPending}
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
        ) : data.verification.available ? null : (
          <Text token="body-small" tone="muted">
            Phone verification is not available for this account right now.
          </Text>
        )}

        {visibleFeedback ? (
          <p
            role={visibleFeedback.tone === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={visibleFeedback.tone === 'error' ? 'text-error' : undefined}
          >
            <Text
              token="body-small"
              tone={visibleFeedback.tone === 'error' ? 'inherit' : undefined}
            >
              {visibleFeedback.copy}
            </Text>
          </p>
        ) : null}
      </>
    );
  };

  // placeholder: the phone numbers this workspace has provisioned for Athena.
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
      {renderLoaded()}
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
        error={removeTarget && feedback?.tone === 'error' ? feedback.copy : null}
        onConfirm={() => {
          if (!removeTarget) return;
          setFeedback(null);
          remove.mutate(removeTarget.id);
        }}
      />
    </SettingsGroup>
  );
}

export default VoicePhoneNumbers;
