/**
 * `VoicePhoneNumbers` — that a code which exists on the server is always enterable.
 *
 * @remarks
 * The regression this file exists for: the code box used to be gated on local state written by the
 * `POST` that sent the code, so a person who requested a code and then reloaded settings — or
 * opened them on the handset the code was texted to — got a row reading "waiting for the code" and
 * the add form, with nowhere to type the code they were holding. Retyping the number then hit the
 * resend limiter and reported a flat failure. Case 1 below is that scenario and fails against the
 * old component.
 *
 * Assertions address structure (`data-phone-*`, roles, form values) rather than wording, so the
 * copy on this surface stays free to change.
 */
import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deferred } from '../support/deferred';
import { makeQueryWrapper, okResponse, problemResponse } from '../support/query';

const numbersGet = vi.fn();
const bindPost = vi.fn();
const verifyPost = vi.fn();
const resendPost = vi.fn();
const removeDelete = vi.fn();
const callingPost = vi.fn();
const callPost = vi.fn();
const reauth = vi.fn();

vi.mock('@/components/settings/use-reauth', () => ({ useReauth: () => reauth }));

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      me: {
        'phone-numbers': {
          $get: numbersGet,
          $post: bindPost,
          ':id': {
            verify: { $post: verifyPost },
            resend: { $post: resendPost },
            calling: { $post: callingPost },
            call: { $post: callPost },
            $delete: removeDelete,
          },
        },
      },
    },
  },
}));

// Imported after the mock above so the module under test shares it.
const { VoicePhoneNumbers } = await import('@/components/athena/voice-phone-numbers');

/** Prose only the server would produce, so leaking it into the UI is unambiguous. */
const SERVER_DIAGNOSTIC = 'psycopg2.errors.UniqueViolation at 0xdeadbeef';

interface NumberOverrides {
  readonly id?: string;
  readonly status?: 'pending' | 'verified' | 'blocked';
  readonly callingEnabled?: boolean;
  readonly lastCalledAt?: string | null;
  readonly challenge?: Record<string, unknown> | null;
}

/** A listed number, pending with a live challenge unless told otherwise. */
function phoneNumber({
  id = 'pn-1',
  status = 'pending',
  callingEnabled = true,
  lastCalledAt = null,
  challenge = status === 'pending' ? challengeSummary() : null,
}: NumberOverrides = {}): Record<string, unknown> {
  return {
    id,
    masked: '+1 ••• ••• ••58',
    dialCode: '1',
    country: 'US',
    status,
    callingEnabled,
    verifiedAt: null,
    lastCalledAt,
    createdAt: '2026-08-15T09:00:00.000Z',
    challenge,
  };
}

/** Challenge limits, expired-cooldown by default so the resend button is live. */
function challengeSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    expiresAt: '2026-08-15T09:10:00.000Z',
    attemptsRemaining: 5,
    resendAvailableAt: '2000-01-01T00:00:00.000Z',
    deliveryFailed: false,
    ...overrides,
  };
}

function listing(...items: Record<string, unknown>[]): unknown {
  return okResponse({ athenaNumber: '+17025550100', items });
}

function renderSection(): ReturnType<typeof render> {
  return render(<VoicePhoneNumbers />, { wrapper: makeQueryWrapper().wrapper });
}

const verifyForm = (): Element | null => document.querySelector('[data-phone-verify-form]');
const addForm = (): Element | null => document.querySelector('[data-phone-add-form]');
const action = (name: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-phone-action="${name}"]`);
const rowAction = (id: string, name: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    `[data-phone-number-id="${id}"] [data-phone-action="${name}"]`,
  );

/** An input addressed by its role in the form rather than by the copy inside it. */
const field = (name: string): HTMLElement =>
  control(document.querySelector<HTMLElement>(`[data-phone-field="${name}"]`), name);

/** The control, or a failure naming the one that was missing rather than a null dereference. */
function control(element: HTMLElement | null, label: string): HTMLElement {
  if (!element) throw new Error(`expected a "${label}" control to be rendered`);
  return element;
}

beforeEach(() => {
  // `resetAllMocks`, not `clearAllMocks`: the latter keeps implementations installed, so a test
  // that forgot to stub a route would quietly reuse the previous test's response and pass because
  // of its neighbour.
  vi.resetAllMocks();
  reauth.mockResolvedValue(undefined);
  numbersGet.mockResolvedValue(listing());
});

afterEach(cleanup);

describe('VoicePhoneNumbers', () => {
  it('shows how calls authenticate and starts a callback to the stored number', async () => {
    numbersGet.mockResolvedValue(
      listing(
        phoneNumber({
          id: 'pn-1',
          status: 'verified',
          lastCalledAt: '2026-08-30T18:30:00.000Z',
        }),
      ),
    );
    callPost.mockResolvedValue(
      okResponse({
        authorizationId: 'auth-1',
        state: 'dialing',
        expiresAt: '2026-08-30T18:35:00.000Z',
      }),
    );
    renderSection();

    expect(await screen.findByRole('link', { name: '+1 702 555 0100' })).toHaveAttribute(
      'href',
      'tel:+17025550100',
    );
    expect(screen.getByText(/carrier can verify/i)).toBeInTheDocument();
    expect(screen.getByText(/last call/i)).toBeInTheDocument();

    await userEvent.click(control(rowAction('pn-1', 'call'), 'call'));
    await waitFor(() => {
      expect(callPost).toHaveBeenCalledWith({ param: { id: 'pn-1' } });
    });
    expect(reauth).not.toHaveBeenCalled();
  });

  it('pauses immediately but requires a passkey before calls are enabled again', async () => {
    numbersGet
      .mockResolvedValueOnce(
        listing(phoneNumber({ id: 'pn-1', status: 'verified', callingEnabled: true })),
      )
      .mockResolvedValue(
        listing(phoneNumber({ id: 'pn-1', status: 'verified', callingEnabled: false })),
      );
    callingPost
      .mockResolvedValueOnce(
        okResponse(phoneNumber({ id: 'pn-1', status: 'verified', callingEnabled: false })),
      )
      .mockResolvedValueOnce(problemResponse('session is stale', 401, 'reauth_required'))
      .mockResolvedValue(
        okResponse(phoneNumber({ id: 'pn-1', status: 'verified', callingEnabled: true })),
      );
    renderSection();

    await waitFor(() => {
      expect(rowAction('pn-1', 'disable-calling')).not.toBeNull();
    });
    await userEvent.click(control(rowAction('pn-1', 'disable-calling'), 'disable-calling'));
    await waitFor(() => {
      expect(callingPost).toHaveBeenCalledWith({
        param: { id: 'pn-1' },
        json: { enabled: false },
      });
    });
    expect(reauth).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(rowAction('pn-1', 'enable-calling')).not.toBeNull();
    });
    await userEvent.click(control(rowAction('pn-1', 'enable-calling'), 'enable-calling'));

    await waitFor(() => {
      expect(reauth).toHaveBeenCalledOnce();
      expect(callingPost).toHaveBeenLastCalledWith({
        param: { id: 'pn-1' },
        json: { enabled: true },
      });
    });
  });

  it('offers the code box for a number the server already reports as pending', async () => {
    // No bind ran in this session — exactly the state a page reload leaves behind.
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1' })));
    verifyPost.mockResolvedValue(okResponse(phoneNumber({ id: 'pn-1', status: 'verified' })));
    renderSection();

    await waitFor(() => {
      expect(verifyForm()).not.toBeNull();
    });
    expect(addForm()).toBeNull();

    await userEvent.type(field('code'), '271828');
    await userEvent.click(control(action('verify'), 'verify'));

    await waitFor(() => {
      expect(verifyPost).toHaveBeenCalledWith({
        param: { id: 'pn-1' },
        json: { code: '271828' },
      });
    });
  });

  it('shows the add form when nothing is awaiting a code', async () => {
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1', status: 'verified' })));
    renderSection();

    await waitFor(() => {
      expect(addForm()).not.toBeNull();
    });
    expect(verifyForm()).toBeNull();
  });

  it('does not expose the add form until the phone-number list loads', async () => {
    const pending = deferred<unknown>();
    numbersGet.mockReturnValue(pending.promise);
    renderSection();

    expect(screen.getByLabelText('Loading phone numbers')).toBeInTheDocument();
    expect(addForm()).toBeNull();

    pending.resolve(listing());
    await waitFor(() => {
      expect(addForm()).not.toBeNull();
    });
  });

  it('shows application-owned recovery when the phone-number list fails', async () => {
    numbersGet.mockResolvedValue(problemResponse(SERVER_DIAGNOSTIC, 503, 'internal'));
    renderSection();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load your phone numbers.');
    expect(alert).not.toHaveTextContent(SERVER_DIAGNOSTIC);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(addForm()).toBeNull();
  });

  it('submits the add and verification forms with Enter', async () => {
    numbersGet
      .mockResolvedValueOnce(listing())
      .mockResolvedValue(listing(phoneNumber({ id: 'pn-1' })));
    bindPost.mockResolvedValue(
      okResponse({ phoneNumber: phoneNumber({ id: 'pn-1' }), ...challengeSummary() }),
    );
    verifyPost.mockResolvedValue(okResponse(phoneNumber({ id: 'pn-1', status: 'verified' })));
    renderSection();

    await waitFor(() => {
      expect(addForm()).not.toBeNull();
    });
    await userEvent.type(field('national-number'), '4155550123{Enter}');
    await waitFor(() => {
      expect(bindPost).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(verifyForm()).not.toBeNull();
    });
    await userEvent.type(field('code'), '314159{Enter}');
    await waitFor(() => {
      expect(verifyPost).toHaveBeenCalledWith({
        param: { id: 'pn-1' },
        json: { code: '314159' },
      });
    });
  });

  it('keeps a second number bindable without abandoning the pending one', async () => {
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1' })));
    renderSection();

    await waitFor(() => {
      expect(verifyForm()).not.toBeNull();
    });

    await userEvent.click(control(action('add-different'), 'add-different'));
    expect(addForm()).not.toBeNull();
    expect(verifyForm()).toBeNull();
    // The pending number is still listed, and still reachable.
    expect(document.querySelector('[data-phone-number-id="pn-1"]')).not.toBeNull();

    await userEvent.click(control(action('back-to-code'), 'back-to-code'));
    expect(verifyForm()).not.toBeNull();
  });

  it('targets the newest pending number but lets an older one be picked', async () => {
    numbersGet.mockResolvedValue(
      listing(phoneNumber({ id: 'pn-new' }), phoneNumber({ id: 'pn-old' })),
    );
    verifyPost.mockResolvedValue(okResponse(phoneNumber({ id: 'pn-new', status: 'verified' })));
    renderSection();

    await waitFor(() => {
      expect(verifyForm()).not.toBeNull();
    });

    await userEvent.type(field('code'), '111111');
    await userEvent.click(control(action('verify'), 'verify'));
    await waitFor(() => {
      expect(verifyPost).toHaveBeenCalledWith({
        param: { id: 'pn-new' },
        json: { code: '111111' },
      });
    });

    await userEvent.click(control(rowAction('pn-old', 'enter-code'), 'enter-code'));
    await userEvent.type(field('code'), '222222');
    await userEvent.click(control(action('verify'), 'verify'));
    await waitFor(() => {
      expect(verifyPost).toHaveBeenLastCalledWith({
        param: { id: 'pn-old' },
        json: { code: '222222' },
      });
    });
  });

  it('holds the code box open between binding and the list catching up', async () => {
    // `bind` invalidates the list rather than awaiting it, so there is a window where the server's
    // last word on this account still predates the number just bound. The box has to be up in that
    // window, or a person holding a code would be shown the add form and retype the number.
    const refetch = deferred<unknown>();
    numbersGet.mockResolvedValueOnce(listing()).mockReturnValueOnce(refetch.promise);
    bindPost.mockResolvedValue(
      okResponse({ phoneNumber: phoneNumber({ id: 'pn-1' }), ...challengeSummary() }),
    );
    renderSection();

    await waitFor(() => {
      expect(addForm()).not.toBeNull();
    });
    await userEvent.type(field('national-number'), '4155550123');
    await userEvent.click(control(action('bind'), 'bind'));

    await waitFor(() => {
      expect(bindPost).toHaveBeenCalledWith({
        json: { country: 'US', dialCode: '1', nationalNumber: '4155550123' },
      });
    });
    // The refetch is still in flight — the server has told this session nothing about the row yet.
    await waitFor(() => {
      expect(verifyForm()).not.toBeNull();
    });
    expect(addForm()).toBeNull();

    // And it survives the refetch landing, rather than only existing until the server answers.
    refetch.resolve(listing(phoneNumber({ id: 'pn-1' })));
    await waitFor(() => {
      expect(document.querySelector('[data-phone-number-id="pn-1"]')).not.toBeNull();
    });
    expect(verifyForm()).not.toBeNull();
  });

  it('re-enables the resend on its own as the cooldown elapses', async () => {
    // Without the ticking clock the button would stay disabled until something else re-rendered
    // the section, which for an idle settings tab is "never".
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const soon = new Date(Date.now() + 5_000).toISOString();
      numbersGet.mockResolvedValue(
        listing(
          phoneNumber({ id: 'pn-1', challenge: challengeSummary({ resendAvailableAt: soon }) }),
        ),
      );
      renderSection();

      await waitFor(() => {
        expect(rowAction('pn-1', 'resend')).toBeDisabled();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      expect(rowAction('pn-1', 'resend')).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies a pending number’s cooldown even when the code box points elsewhere', async () => {
    // Each row owns its own cooldown; the one being verified is not the only one that can have
    // had a code sent moments ago.
    const soon = new Date(Date.now() + 60_000).toISOString();
    numbersGet.mockResolvedValue(
      listing(
        phoneNumber({ id: 'pn-new' }),
        phoneNumber({ id: 'pn-old', challenge: challengeSummary({ resendAvailableAt: soon }) }),
      ),
    );
    renderSection();

    await waitFor(() => {
      expect(rowAction('pn-old', 'resend')).not.toBeNull();
    });
    // `pn-new` is the code box's target; `pn-old` is not, and is still within its own window.
    expect(rowAction('pn-new', 'resend')).toBeEnabled();
    expect(rowAction('pn-old', 'resend')).toBeDisabled();
  });

  it('offers a blocked number neither a code box nor a resend', async () => {
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1', status: 'blocked' })));
    renderSection();

    await waitFor(() => {
      expect(document.querySelector('[data-phone-number-id="pn-1"]')).not.toBeNull();
    });
    expect(verifyForm()).toBeNull();
    expect(rowAction('pn-1', 'resend')).toBeNull();
    expect(rowAction('pn-1', 'enter-code')).toBeNull();
    expect(addForm()).not.toBeNull();
  });

  it('reports a code the server could not deliver, read straight off the listed number', async () => {
    // No mutation ran here — this is the reload case, where the only source is the listed row.
    numbersGet.mockResolvedValue(
      listing(phoneNumber({ id: 'pn-1', challenge: challengeSummary({ deliveryFailed: true }) })),
    );
    renderSection();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('reports a resent code that could not be delivered', async () => {
    const failed = challengeSummary({ deliveryFailed: true });
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1' })));
    resendPost.mockResolvedValue(
      okResponse({
        phoneNumber: phoneNumber({ id: 'pn-1', challenge: failed }),
        ...failed,
      }),
    );
    renderSection();

    await waitFor(() => {
      expect(rowAction('pn-1', 'resend')).not.toBeNull();
    });
    // The resend invalidates the list, and the server would report the failure on the row too.
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1', challenge: failed })));
    await userEvent.click(control(rowAction('pn-1', 'resend'), 'resend'));

    await waitFor(() => {
      expect(resendPost).toHaveBeenCalledWith({ param: { id: 'pn-1' } });
    });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('reconciles the list after a resend so the new code’s limits are the ones shown', async () => {
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1' })));
    resendPost.mockResolvedValue(
      okResponse({ phoneNumber: phoneNumber({ id: 'pn-1' }), ...challengeSummary() }),
    );
    renderSection();

    await waitFor(() => {
      expect(rowAction('pn-1', 'resend')).not.toBeNull();
    });
    const before = numbersGet.mock.calls.length;
    await userEvent.click(control(rowAction('pn-1', 'resend'), 'resend'));

    await waitFor(() => {
      expect(numbersGet.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it('surfaces a delete that failed instead of leaving the row unexplained', async () => {
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1', status: 'verified' })));
    removeDelete.mockResolvedValue(problemResponse(SERVER_DIAGNOSTIC, 500, 'internal'));
    renderSection();

    await waitFor(() => {
      expect(rowAction('pn-1', 'remove')).not.toBeNull();
    });
    await userEvent.click(control(rowAction('pn-1', 'remove'), 'remove'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove phone number' }));

    // The mutation really ran — without this the test would pass on a mis-wired mock throwing.
    await waitFor(() => {
      expect(removeDelete).toHaveBeenCalledWith({ param: { id: 'pn-1' } });
    });
    const alert = await screen.findByRole('alert');
    // Application-owned copy only — never the server's title or detail.
    expect(alert.textContent).not.toContain(SERVER_DIAGNOSTIC);
  });

  it('closes the code box when the number being verified is removed', async () => {
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1' })));
    removeDelete.mockResolvedValue(okResponse(phoneNumber({ id: 'pn-1' })));
    renderSection();

    await waitFor(() => {
      expect(verifyForm()).not.toBeNull();
    });
    numbersGet.mockResolvedValue(listing());
    await userEvent.click(control(rowAction('pn-1', 'remove'), 'remove'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove phone number' }));

    await waitFor(() => {
      expect(removeDelete).toHaveBeenCalledWith({ param: { id: 'pn-1' } });
    });
    await waitFor(() => {
      expect(verifyForm()).toBeNull();
    });
    expect(addForm()).not.toBeNull();
  });

  it('refreshes the remaining tries when a code is rejected', async () => {
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1' })));
    verifyPost.mockResolvedValue(problemResponse('wrong code, 2 tries left', 409, 'conflict'));
    renderSection();

    await waitFor(() => {
      expect(verifyForm()).not.toBeNull();
    });
    const before = numbersGet.mock.calls.length;
    await userEvent.type(field('code'), '000000');
    await userEvent.click(control(action('verify'), 'verify'));

    // The server just spent one of the tries this section promises to state.
    await waitFor(() => {
      expect(numbersGet.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it('describes the code’s real expiry rather than a fixed sentence', async () => {
    const expiresAt = '2026-08-15T09:37:00.000Z';
    numbersGet.mockResolvedValue(
      listing(phoneNumber({ id: 'pn-1', challenge: challengeSummary({ expiresAt }) })),
    );
    renderSection();

    await waitFor(() => {
      expect(verifyForm()).not.toBeNull();
    });
    expect(verifyForm()?.querySelector('time')?.getAttribute('datetime')).toBe(expiresAt);
  });
});
