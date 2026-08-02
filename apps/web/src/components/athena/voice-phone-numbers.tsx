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
 */
import type { PhoneChallengeOut, PhoneNumberOut } from '@docket/types';
import { DIAL_CODES, DEFAULT_DIAL_CODE } from '@docket/types';
import { Check, Phone, PhoneOff, Trash2 } from '@docket/ui/icons';
import { Badge, Button, ControlGroup, Field, Input, Select, Text } from '@docket/ui/primitives';
import { type JSX, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

/** The country preselected when nothing has been bound yet. */
const DEFAULT_COUNTRY = 'US';

/** The section heading and the promise it makes. */
const SECTION_DESCRIPTION =
  'Add a number and Athena will answer when you call from it, picking up the same conversation you have on the web.';

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
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<PhoneChallengeOut | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dialCode = useMemo(
    () => DIAL_CODES.find((option) => option.iso2 === country)?.dialCode ?? DEFAULT_DIAL_CODE,
    [country],
  );

  const numbersQ = useApiQuery(
    apiQueryOptions(
      queryKeys.phoneNumbers(),
      () => api.v1.me['phone-numbers'].$get(),
      'Could not load your phone numbers.',
    ),
  );

  const bind = useApiMutation<PhoneChallengeOut, undefined>({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.me['phone-numbers'].$post({
            json: { country, dialCode, nationalNumber },
          }),
        'Could not send the code.',
      ),
    invalidateKeys: [queryKeys.phoneNumbers()],
    onSuccess: (result) => {
      setChallenge(result);
      setPendingId(result.phoneNumber.id);
      setNationalNumber('');
      setNotice(
        result.deliveryFailed
          ? 'We couldn’t deliver the code to that number. Check it and try again.'
          : null,
      );
    },
    onError: (error) => {
      setNotice(userErrorMessage(error, 'Could not send the code.'));
    },
  });

  const verify = useApiMutation<PhoneNumberOut, string>({
    mutationFn: (id) =>
      unwrap(
        () => api.v1.me['phone-numbers'][':id'].verify.$post({ param: { id }, json: { code } }),
        'That code didn’t work.',
      ),
    invalidateKeys: [queryKeys.phoneNumbers()],
    onSuccess: () => {
      setPendingId(null);
      setChallenge(null);
      setCode('');
      setNotice(null);
    },
    onError: (error) => {
      setNotice(userErrorMessage(error, 'That code didn’t work.'));
    },
  });

  const resend = useApiMutation<PhoneChallengeOut, string>({
    mutationFn: (id) =>
      unwrap(
        () => api.v1.me['phone-numbers'][':id'].resend.$post({ param: { id } }),
        'Could not send another code.',
      ),
    onSuccess: (result) => {
      setChallenge(result);
      setNotice(null);
    },
    onError: (error) => {
      setNotice(userErrorMessage(error, 'Could not send another code.'));
    },
  });

  const remove = useApiMutation<PhoneNumberOut, string>({
    mutationFn: (id) =>
      unwrap(
        () => api.v1.me['phone-numbers'][':id'].$delete({ param: { id } }),
        'Could not remove that number.',
      ),
    invalidateKeys: [queryKeys.phoneNumbers()],
  });

  const items = numbersQ.data?.items ?? [];

  return (
    <section
      className="bg-surface-container-low flex max-w-2xl flex-col gap-5 rounded-lg p-5"
      data-phone-numbers-section
    >
      <div className="flex flex-col gap-1">
        <Text as="h2" token="title-medium">
          Call Athena
        </Text>
        <Text token="body-medium" tone="muted">
          {SECTION_DESCRIPTION}
        </Text>
      </div>

      {items.length > 0 ? (
        <ul className="flex flex-col gap-2" data-phone-number-list>
          {items.map((number) => (
            <li
              key={number.id}
              className="bg-surface-container flex items-center gap-3 rounded-md px-3 py-2"
            >
              <span aria-hidden="true" className="text-on-surface-variant">
                {number.status === 'verified' ? (
                  <Phone className="size-4.5" />
                ) : (
                  <PhoneOff className="size-4.5" />
                )}
              </span>
              <Text token="body-medium" numeric>
                {number.masked}
              </Text>
              <Badge variant={number.status === 'verified' ? 'secondary' : 'outline'}>
                {number.status === 'verified' ? 'Verified' : 'Waiting for the code'}
              </Badge>
              <span className="flex-1" />
              <ControlGroup controlSize="sm">
                {number.status !== 'verified' ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPendingId(number.id);
                      resend.mutate(number.id);
                    }}
                  >
                    Send a new code
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  iconOnly
                  aria-label={`Remove ${number.masked}`}
                  onClick={() => {
                    remove.mutate(number.id);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </ControlGroup>
            </li>
          ))}
        </ul>
      ) : null}

      {pendingId ? (
        <div className="flex flex-col gap-3" data-phone-verify-form>
          <Field
            label="Enter the 6-digit code"
            description={
              challenge
                ? `We texted it just now. It expires in 10 minutes, and you have ${String(challenge.attemptsRemaining)} tries.`
                : 'We texted it just now.'
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
            />
          </Field>
          <ControlGroup>
            <Button
              disabled={code.length !== 6 || verify.isPending}
              onClick={() => {
                verify.mutate(pendingId);
              }}
            >
              <Check aria-hidden="true" />
              Verify
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPendingId(null);
                setCode('');
                setNotice(null);
              }}
            >
              Cancel
            </Button>
          </ControlGroup>
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-phone-add-form>
          <ControlGroup controlSize="lg" wrap className="items-end">
            <Field label="Country">
              <Select
                value={country}
                onChange={(event) => {
                  setCountry(event.target.value);
                }}
                aria-label="Country calling code"
              >
                {DIAL_CODES.map((option) => (
                  <option key={option.iso2} value={option.iso2}>
                    {option.name} +{option.dialCode}
                  </option>
                ))}
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
              />
            </Field>
          </ControlGroup>
          <ControlGroup>
            <Button
              disabled={nationalNumber.trim().length < 4 || bind.isPending}
              onClick={() => {
                bind.mutate(undefined);
              }}
            >
              <Phone aria-hidden="true" />
              Send me a code
            </Button>
          </ControlGroup>
        </div>
      )}

      {notice ? (
        <p role="alert" className="text-error">
          <Text token="body-small" tone="inherit">
            {notice}
          </Text>
        </p>
      ) : null}
    </section>
  );
}

export default VoicePhoneNumbers;
