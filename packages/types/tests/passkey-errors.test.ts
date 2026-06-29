/**
 * Unit tests for the shared passkey ceremony error mapper.
 *
 * @remarks
 * These tests pin the contract that clients render only Docket-owned copy. Raw browser,
 * WebAuthn, and upstream Better Auth messages are classifier inputs, not UI strings.
 */
import { describe, expect, it } from 'vitest';

import {
  ALREADY_REGISTERED_MESSAGE,
  isPasskeyUnknownToServer,
  isServerUnavailable,
  PASSKEY_NOT_FOUND_CODE,
  PASSKEY_NOT_FOUND_MESSAGE,
  PASSKEY_PROMPT_CANCELLED_MESSAGE,
  passkeyErrorKind,
  passkeyErrorMessage,
  passkeyUserMessage,
  PREVIOUSLY_REGISTERED_CODE,
  SERVER_UNAVAILABLE_MESSAGE,
} from '../src/passkey-errors';

const TRANSIENT = 'Please try again.';

describe('isServerUnavailable', () => {
  it('is true only for 5xx statuses', () => {
    expect(isServerUnavailable(500)).toBe(true);
    expect(isServerUnavailable(599)).toBe(true);
    expect(isServerUnavailable(400)).toBe(false);
    expect(isServerUnavailable(200)).toBe(false);
    expect(isServerUnavailable(undefined)).toBe(false);
  });
});

describe('isPasskeyUnknownToServer', () => {
  it('is true only for the PASSKEY_NOT_FOUND code', () => {
    expect(isPasskeyUnknownToServer({ code: PASSKEY_NOT_FOUND_CODE, status: 401 })).toBe(true);
    expect(isPasskeyUnknownToServer({ code: PREVIOUSLY_REGISTERED_CODE, status: 400 })).toBe(false);
    expect(isPasskeyUnknownToServer({ status: 401, message: 'Unauthorized' })).toBe(false);
    expect(isPasskeyUnknownToServer(null)).toBe(false);
    expect(isPasskeyUnknownToServer(undefined)).toBe(false);
  });
});

describe('passkeyErrorMessage', () => {
  it('maps the server-deleted-passkey code to the unknown-credential copy', () => {
    const envelope = {
      code: PASSKEY_NOT_FOUND_CODE,
      message: 'Passkey not found',
      status: 401,
      statusText: 'UNAUTHORIZED',
    };
    expect(passkeyErrorKind(envelope)).toBe('unknown_credential');
    expect(passkeyUserMessage(envelope, TRANSIENT)).toEqual({
      kind: 'unknown_credential',
      message: PASSKEY_NOT_FOUND_MESSAGE,
    });
  });

  it('maps the duplicate-account code to the actionable sign-in copy', () => {
    expect(
      passkeyErrorMessage(
        { code: PREVIOUSLY_REGISTERED_CODE, message: 'Previously registered', status: 400 },
        TRANSIENT,
      ),
    ).toBe(ALREADY_REGISTERED_MESSAGE);
  });

  it('prefers the duplicate-account code over status and raw upstream text', () => {
    expect(
      passkeyUserMessage(
        { code: PREVIOUSLY_REGISTERED_CODE, message: 'Previously registered', status: 503 },
        TRANSIENT,
      ),
    ).toEqual({ kind: 'already_registered', message: ALREADY_REGISTERED_MESSAGE });
  });

  it('surfaces the outage-aware message for a 5xx without a known code', () => {
    expect(passkeyUserMessage({ status: 500, message: 'boom' }, TRANSIENT)).toEqual({
      kind: 'server_unavailable',
      message: SERVER_UNAVAILABLE_MESSAGE,
    });
  });

  it('maps raw WebAuthn timeout/denial copy to friendly prompt copy', () => {
    const raw =
      'The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.';
    expect(passkeyErrorKind({ status: 400, message: raw })).toBe('cancelled_or_timed_out');
    expect(passkeyErrorMessage({ status: 400, message: raw }, TRANSIENT)).toBe(
      PASSKEY_PROMPT_CANCELLED_MESSAGE,
    );
  });

  it('maps DOM-style NotAllowedError shapes to friendly prompt copy', () => {
    expect(
      passkeyUserMessage(
        { name: 'NotAllowedError', message: 'The operation was not allowed.' },
        TRANSIENT,
      ),
    ).toEqual({ kind: 'cancelled_or_timed_out', message: PASSKEY_PROMPT_CANCELLED_MESSAGE });
  });

  it('does not expose unknown upstream messages for other failures', () => {
    expect(passkeyErrorMessage({ status: 400, message: 'Ceremony cancelled.' }, TRANSIENT)).toBe(
      TRANSIENT,
    );
  });

  it('falls back to transient copy when there is no typed match', () => {
    expect(passkeyUserMessage({ status: 400 }, TRANSIENT)).toEqual({
      kind: 'transient',
      message: TRANSIENT,
    });
    expect(passkeyErrorMessage(null, TRANSIENT)).toBe(TRANSIENT);
    expect(passkeyErrorMessage(undefined, TRANSIENT)).toBe(TRANSIENT);
  });
});
