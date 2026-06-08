/**
 * Unit tests for the passkey-ceremony error → user-facing message mapping.
 *
 * @remarks
 * This pure module decides what a failed passkey ceremony says to the user, and the ordering of
 * its cases is the contract that matters:
 *
 * - the duplicate-account case (Better Auth's `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED`, whose
 *   terse upstream "Previously registered" message is unhelpful) must surface the plain,
 *   actionable "Sign in instead." copy — and must do so even when the status would otherwise
 *   look like a server error, so it is keyed on the stable `code`, never the wording;
 * - a 5xx surfaces the outage-aware message rather than inviting a futile retry;
 * - everything else prefers the error's own message, falling back to the screen's transient copy.
 *
 * Kept independent of the React tree so the copy contract is pinned where the logic lives.
 */
import { describe, expect, it } from 'vitest';

import {
  ALREADY_REGISTERED_MESSAGE,
  isServerUnavailable,
  passkeyErrorMessage,
  PREVIOUSLY_REGISTERED_CODE,
  SERVER_UNAVAILABLE_MESSAGE,
} from '../src/app/(auth)/_lib/passkey-error';

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

describe('passkeyErrorMessage', () => {
  it('maps the duplicate-account code to the actionable sign-in copy', () => {
    expect(
      passkeyErrorMessage(
        { code: PREVIOUSLY_REGISTERED_CODE, message: 'Previously registered', status: 400 },
        TRANSIENT,
      ),
    ).toBe(ALREADY_REGISTERED_MESSAGE);
  });

  it('prefers the duplicate-account copy over the raw upstream message and any status', () => {
    // Keyed on the stable code, never the terse wording, so it survives upstream changes.
    expect(
      passkeyErrorMessage(
        { code: PREVIOUSLY_REGISTERED_CODE, message: 'Previously registered', status: 503 },
        TRANSIENT,
      ),
    ).toBe(ALREADY_REGISTERED_MESSAGE);
  });

  it('surfaces the outage-aware message for a 5xx without a known code', () => {
    expect(passkeyErrorMessage({ status: 500, message: 'boom' }, TRANSIENT)).toBe(
      SERVER_UNAVAILABLE_MESSAGE,
    );
  });

  it("prefers the error's own message for other failures", () => {
    expect(passkeyErrorMessage({ status: 400, message: 'Ceremony cancelled.' }, TRANSIENT)).toBe(
      'Ceremony cancelled.',
    );
  });

  it('falls back to the transient copy when there is no message', () => {
    expect(passkeyErrorMessage({ status: 400 }, TRANSIENT)).toBe(TRANSIENT);
    expect(passkeyErrorMessage(null, TRANSIENT)).toBe(TRANSIENT);
    expect(passkeyErrorMessage(undefined, TRANSIENT)).toBe(TRANSIENT);
  });
});
