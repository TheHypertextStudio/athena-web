/**
 * Fixtures and DOM addressing for the phone-number settings section's tests.
 *
 * @remarks
 * Elements are addressed by their `data-phone-*` attributes rather than by copy, so the wording on
 * the surface stays free to change.
 */
import { okResponse } from './query';

/** Prose only the server would produce, so leaking it into the UI is unambiguous. */
export const SERVER_DIAGNOSTIC = 'psycopg2.errors.UniqueViolation at 0xdeadbeef';

/** What a test may override on a listed number. */
export interface NumberOverrides {
  readonly id?: string;
  readonly status?: 'pending' | 'verified' | 'blocked';
  readonly callingEnabled?: boolean;
  readonly lastCalledAt?: string | null;
  readonly challenge?: Record<string, unknown> | null;
}

/** Challenge limits, expired-cooldown by default so the resend button is live. */
export function challengeSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'awaiting_code',
    expiresAt: '2099-08-15T09:10:00.000Z',
    attemptsRemaining: 5,
    resendAvailableAt: '2000-01-01T00:00:00.000Z',
    deliveryFailed: false,
    ...overrides,
  };
}

/** A listed number, pending with a live challenge unless told otherwise. */
export function phoneNumber({
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

/** The list response, with verification available. */
export function listing(...items: Record<string, unknown>[]): unknown {
  return okResponse({
    athenaNumber: '+17025550100',
    verification: { available: true, reason: null },
    items,
  });
}

/** The list response when verification cannot run. */
export function unavailableListing(
  reason: 'rollout_restricted' | 'temporarily_unavailable',
): unknown {
  return okResponse({
    athenaNumber: '+17025550100',
    verification: { available: false, reason },
    items: [],
  });
}

/** The verification form, when rendered. */
export const verifyForm = (): Element | null => document.querySelector('[data-phone-verify-form]');

/** The add-number form, when rendered. */
export const addForm = (): Element | null => document.querySelector('[data-phone-add-form]');

/** A form-level action button by its `data-phone-action` name. */
export const action = (name: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-phone-action="${name}"]`);

/** An action button inside one listed number's row. */
export const rowAction = (id: string, name: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    `[data-phone-number-id="${id}"] [data-phone-action="${name}"]`,
  );

/** The control, or a failure naming the one that was missing rather than a null dereference. */
export function control(element: HTMLElement | null, label: string): HTMLElement {
  if (!element) throw new Error(`expected a "${label}" control to be rendered`);
  return element;
}

/** An input addressed by its role in the form rather than by the copy inside it. */
export const field = (name: string): HTMLElement =>
  control(document.querySelector<HTMLElement>(`[data-phone-field="${name}"]`), name);
