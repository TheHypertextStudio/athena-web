'use client';

/**
 * `@docket/ui` — the imperative notice API behind the {@link Toaster}.
 *
 * @remarks
 * A notice is application-owned copy: a title, an optional line of detail, a tone, and at most one
 * action. The type has no slot for an `Error`, so a caller has to resolve copy before it gets
 * here, which is what keeps provider text and exception messages off the screen. Notices with the
 * same `dedupeKey` replace each other instead of stacking, so a failing poll shows one card rather
 * than a column of identical ones.
 */
import { createElement } from 'react';
import { toast as sonner } from 'sonner';

import { ToastCard } from './ToastCard';

/** The urgency a notice reads with. A failure is `critical`; a confirmation is `positive`. */
export type ToastTone = 'neutral' | 'positive' | 'critical';

/** An action a notice offers: something to do here, or somewhere to go. */
export type ToastAction =
  | { readonly label: string; readonly onSelect: () => void }
  | { readonly label: string; readonly href: string };

/** One notice, as the caller states it. */
export interface ToastNotice {
  readonly title: string;
  readonly detail?: string | undefined;
  /** Default `neutral`. */
  readonly tone?: ToastTone | undefined;
  readonly action?: ToastAction | undefined;
  /** Notices sharing a key replace each other instead of stacking. */
  readonly dedupeKey?: string | undefined;
  /** How long the notice stays, in milliseconds. Defaults by tone; a failure stays longer. */
  readonly durationMs?: number | undefined;
}

/** How long a notice of each tone stays, in milliseconds. */
const DEFAULT_DURATION_MS: Readonly<Record<ToastTone, number>> = {
  neutral: 5_000,
  positive: 5_000,
  critical: 8_000,
};

/** Ids are handed out here: sonner compares ids strictly, so they are strings from the start. */
let nextNoticeId = 0;

/**
 * Show a notice.
 *
 * @param notice - The notice to show.
 * @returns the notice's id, for {@link dismissNotice}.
 */
export function notify(notice: ToastNotice): string {
  const tone = notice.tone ?? 'neutral';
  const id = notice.dedupeKey ?? `notice-${(nextNoticeId += 1)}`;
  sonner.custom(
    (toastId) =>
      createElement(ToastCard, {
        title: notice.title,
        detail: notice.detail,
        tone,
        action: notice.action,
        onDismiss: () => {
          sonner.dismiss(toastId);
        },
      }),
    { id, duration: notice.durationMs ?? DEFAULT_DURATION_MS[tone] },
  );
  return id;
}

/** Show a failure notice: `critical` tone, and it stays until read. */
export function notifyFailure(notice: Omit<ToastNotice, 'tone'>): string {
  return notify({ ...notice, tone: 'critical' });
}

/** Remove a notice before it times out. */
export function dismissNotice(id: string): void {
  sonner.dismiss(id);
}
