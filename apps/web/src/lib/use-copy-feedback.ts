'use client';

/**
 * `lib/use-copy-feedback` — the one acknowledgement a copy gets.
 *
 * @remarks
 * Docket has no toast system, deliberately. Transient confirmation is done in place: the control
 * that was pressed says what happened, and a polite live region says the same thing for anyone not
 * looking at it. That pattern was invented once for the code-block copy button and then re-typed,
 * slightly differently, at every other copy site — one with a 2s reset, one with 3s, one that never
 * resets at all, and only one with a live region.
 *
 * This hook is that pattern, owned in one place: a three-state acknowledgement, a timer that returns
 * to rest, and the sentence to announce. Callers render `state` on the control and `announcement`
 * inside an `aria-live="polite"` element.
 *
 * The `failed` state is not decoration. A clipboard write can be refused by permission policy, by a
 * non-secure context, or by the platform ignoring a write outside a user gesture, and a copy that
 * silently does nothing is the worst possible outcome — the user walks away believing they have the
 * content. So {@link ClipboardPayload} writes report a boolean and this hook turns `false` into
 * something the user can see and retry.
 *
 * @see {@link ./clipboard/write} for the write itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { type ClipboardPayload, writeClipboard } from './clipboard/write';

/** Where a copy control currently stands. */
export type CopyState = 'idle' | 'copied' | 'failed';

/** How long an acknowledgement stays before the control returns to rest. */
const DEFAULT_RESET_MS = 3000;

/** Application-owned copy for the two outcomes, and how long to hold them. */
export interface CopyFeedbackOptions {
  /**
   * Announced after a successful copy.
   *
   * @remarks
   * Application-owned copy, always. Never pass an exception or provider message through here.
   */
  readonly copiedMessage?: string;
  /** Announced after a failed copy — should tell the user retrying is worthwhile. */
  readonly failedMessage?: string;
  /** Milliseconds before returning to `idle`. */
  readonly resetMs?: number;
}

/** What {@link useCopyFeedback} exposes. */
export interface CopyFeedback {
  /** The current acknowledgement state, for `data-copy-state` and label swapping. */
  readonly state: CopyState;
  /**
   * The sentence to render inside a polite live region, or `''` at rest.
   *
   * @remarks
   * Empty at rest rather than absent, so the live region element stays mounted. A region that is
   * added to the DOM at the same moment its text appears is frequently not announced at all.
   */
  readonly announcement: string;
  /** Write both flavors, then acknowledge the outcome. */
  readonly copy: (payload: ClipboardPayload) => Promise<void>;
  /** Write a single plain-text flavor, then acknowledge the outcome. */
  readonly copyText: (text: string) => Promise<void>;
}

/**
 * Track and announce the outcome of a copy.
 *
 * @param options - Application-owned messages and the reset delay.
 * @returns The acknowledgement state and the two write helpers.
 *
 * @example
 * ```tsx
 * const { state, announcement, copyText } = useCopyFeedback({ copiedMessage: 'Code copied.' });
 * <Button data-copy-state={state} onClick={() => void copyText(code)}>…</Button>
 * <p aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>
 * ```
 */
export function useCopyFeedback(options: CopyFeedbackOptions = {}): CopyFeedback {
  const {
    copiedMessage = 'Copied.',
    failedMessage = 'Could not copy. Try again.',
    resetMs = DEFAULT_RESET_MS,
  } = options;

  const [state, setState] = useState<CopyState>('idle');
  // A write resolves after an await, by which time the caller may be gone. Writing state into an
  // unmounted component is a warning at best and a leak at worst, so the outcome is dropped.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (state === 'idle') return;
    const timeout = window.setTimeout(() => {
      setState('idle');
    }, resetMs);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [state, resetMs]);

  const settle = useCallback((wrote: boolean) => {
    if (!mountedRef.current) return;
    setState(wrote ? 'copied' : 'failed');
  }, []);

  const copy = useCallback(
    async (payload: ClipboardPayload): Promise<void> => {
      settle(await writeClipboard(payload));
    },
    [settle],
  );

  const copyText = useCallback(
    async (text: string): Promise<void> => {
      settle(await writeClipboard({ text, html: '' }));
    },
    [settle],
  );

  return {
    state,
    announcement: state === 'copied' ? copiedMessage : state === 'failed' ? failedMessage : '',
    copy,
    copyText,
  };
}
