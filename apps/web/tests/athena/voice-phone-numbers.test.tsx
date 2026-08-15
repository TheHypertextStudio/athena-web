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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const numbersGet = vi.fn();
const bindPost = vi.fn();
const verifyPost = vi.fn();
const resendPost = vi.fn();
const removeDelete = vi.fn();

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
          },
          $delete: removeDelete,
        },
      },
    },
  },
}));

// Imported after the mock above so the module under test shares it.
const { VoicePhoneNumbers } = await import('@/components/athena/voice-phone-numbers');

/** The shape `unwrap` consumes: a `Response`-like with `ok`, `status`, and `json()`. */
function jsonResponse(body: unknown, { ok = true, status = 200 } = {}): unknown {
  return { ok, status, json: async () => body };
}

interface NumberOverrides {
  readonly id?: string;
  readonly status?: 'pending' | 'verified' | 'blocked';
  readonly challenge?: Record<string, unknown> | null;
}

/** A listed number, pending with a live challenge unless told otherwise. */
function phoneNumber(overrides: NumberOverrides = {}): Record<string, unknown> {
  const status = overrides.status ?? 'pending';
  return {
    id: overrides.id ?? 'pn-1',
    masked: '+1 ••• ••• ••58',
    dialCode: '1',
    country: 'US',
    status,
    callingEnabled: true,
    verifiedAt: null,
    createdAt: '2026-08-15T09:00:00.000Z',
    challenge:
      overrides.challenge !== undefined
        ? overrides.challenge
        : status === 'pending'
          ? challengeSummary()
          : null,
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
  return jsonResponse({ items });
}

function renderSection(): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VoicePhoneNumbers />
    </QueryClientProvider>,
  );
}

const verifyForm = (): Element | null => document.querySelector('[data-phone-verify-form]');
const addForm = (): Element | null => document.querySelector('[data-phone-add-form]');
const action = (name: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-phone-action="${name}"]`);
const rowAction = (id: string, name: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    `[data-phone-number-id="${id}"] [data-phone-action="${name}"]`,
  );

/** The control, or a failure naming the one that was missing rather than a null dereference. */
function control(element: HTMLElement | null, label: string): HTMLElement {
  if (!element) throw new Error(`expected a "${label}" control to be rendered`);
  return element;
}

beforeEach(() => {
  vi.clearAllMocks();
  numbersGet.mockResolvedValue(listing());
});

afterEach(cleanup);

describe('VoicePhoneNumbers', () => {
  it('offers the code box for a number the server already reports as pending', async () => {
    // No bind ran in this session — exactly the state a page reload leaves behind.
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1' })));
    verifyPost.mockResolvedValue(jsonResponse(phoneNumber({ id: 'pn-1', status: 'verified' })));
    renderSection();

    await waitFor(() => {
      expect(verifyForm()).not.toBeNull();
    });
    expect(addForm()).toBeNull();

    await userEvent.type(screen.getByPlaceholderText('000000'), '271828');
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
    verifyPost.mockResolvedValue(jsonResponse(phoneNumber({ id: 'pn-new', status: 'verified' })));
    renderSection();

    await waitFor(() => {
      expect(verifyForm()).not.toBeNull();
    });

    await userEvent.type(screen.getByPlaceholderText('000000'), '111111');
    await userEvent.click(control(action('verify'), 'verify'));
    await waitFor(() => {
      expect(verifyPost).toHaveBeenCalledWith({
        param: { id: 'pn-new' },
        json: { code: '111111' },
      });
    });

    await userEvent.click(control(rowAction('pn-old', 'enter-code'), 'enter-code'));
    await userEvent.type(screen.getByPlaceholderText('000000'), '222222');
    await userEvent.click(control(action('verify'), 'verify'));
    await waitFor(() => {
      expect(verifyPost).toHaveBeenLastCalledWith({
        param: { id: 'pn-old' },
        json: { code: '222222' },
      });
    });
  });

  it('holds the code box open between binding and the list catching up', async () => {
    // `bind` invalidates the list rather than awaiting it; without the optimistic bridge the add
    // form would flash back for one round trip.
    numbersGet.mockResolvedValue(listing());
    bindPost.mockResolvedValue(
      jsonResponse({
        phoneNumber: phoneNumber({ id: 'pn-1' }),
        ...challengeSummary(),
      }),
    );
    renderSection();

    await waitFor(() => {
      expect(addForm()).not.toBeNull();
    });
    await userEvent.type(screen.getByPlaceholderText('415 555 0123'), '4155550123');
    await userEvent.click(control(action('bind'), 'bind'));

    await waitFor(() => {
      expect(bindPost).toHaveBeenCalledWith({
        json: { country: 'US', dialCode: '1', nationalNumber: '4155550123' },
      });
    });
    // The list still reports nothing, yet the code box is up.
    await waitFor(() => {
      expect(verifyForm()).not.toBeNull();
    });
  });

  it('refuses to invite a resend the cooldown will reject', async () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    numbersGet.mockResolvedValue(
      listing(
        phoneNumber({ id: 'pn-1', challenge: challengeSummary({ resendAvailableAt: soon }) }),
      ),
    );
    renderSection();

    await waitFor(() => {
      expect(rowAction('pn-1', 'resend')).not.toBeNull();
    });
    expect(rowAction('pn-1', 'resend')).toBeDisabled();
  });

  it('enables the resend once the cooldown has passed', async () => {
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1' })));
    renderSection();

    await waitFor(() => {
      expect(rowAction('pn-1', 'resend')).not.toBeNull();
    });
    expect(rowAction('pn-1', 'resend')).toBeEnabled();
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

  it('reports a resent code that could not be delivered', async () => {
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1' })));
    resendPost.mockResolvedValue(
      jsonResponse({
        phoneNumber: phoneNumber({ id: 'pn-1' }),
        ...challengeSummary({ deliveryFailed: true }),
      }),
    );
    renderSection();

    await waitFor(() => {
      expect(rowAction('pn-1', 'resend')).not.toBeNull();
    });
    await userEvent.click(control(rowAction('pn-1', 'resend'), 'resend'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('reconciles the list after a resend so the new code’s limits are the ones shown', async () => {
    numbersGet.mockResolvedValue(listing(phoneNumber({ id: 'pn-1' })));
    resendPost.mockResolvedValue(
      jsonResponse({ phoneNumber: phoneNumber({ id: 'pn-1' }), ...challengeSummary() }),
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
    removeDelete.mockResolvedValue(
      jsonResponse(
        { code: 'internal', title: 'Boom', detail: 'stack' },
        { ok: false, status: 500 },
      ),
    );
    renderSection();

    await waitFor(() => {
      expect(rowAction('pn-1', 'remove')).not.toBeNull();
    });
    await userEvent.click(control(rowAction('pn-1', 'remove'), 'remove'));

    const alert = await screen.findByRole('alert');
    // Application-owned copy only — never the server's title or detail.
    expect(alert.textContent).not.toContain('Boom');
    expect(alert.textContent).not.toContain('stack');
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
