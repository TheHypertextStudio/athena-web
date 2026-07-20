import type { JSX, ReactNode } from 'react';

/** Props for {@link CardNote}. */
export interface CardNoteProps {
  /** `error` colors the text destructive and marks it as an alert; `muted` is a quiet notice. */
  tone: 'error' | 'muted';
  children: ReactNode;
}

/**
 * A footer note beneath an integration card's header (an error or an info notice).
 *
 * @remarks
 * Shared by the generic provider card and the Google Tasks rows so the tonal-step footer
 * (`bg-surface-container`, no divider border) reads identically everywhere. `error` notes announce
 * themselves to assistive tech; `muted` notes don't.
 */
export function CardNote({ tone, children }: CardNoteProps): JSX.Element {
  const color = tone === 'error' ? 'text-destructive' : 'text-on-surface-variant';
  return (
    <p
      {...(tone === 'error' ? { role: 'alert' } : {})}
      className={`${color} bg-surface-container px-4 py-2 text-xs`}
    >
      {children}
    </p>
  );
}

/** Props for {@link CardAlert}. */
export interface CardAlertProps {
  /** The primary destructive line. */
  message: string;
  /** A quieter follow-up line (e.g. the recommended recovery action). */
  detail: ReactNode;
}

/**
 * A two-line persistent alert footer: a destructive message plus a muted recovery hint.
 *
 * @remarks
 * Used for server-truth connection errors that survive reload (never ephemeral state). The copy
 * differs per surface, so callers pass it in; only the two-tone layout is shared here.
 */
export function CardAlert({ message, detail }: CardAlertProps): JSX.Element {
  return (
    <div role="alert" className="bg-surface-container px-4 py-2 text-xs">
      <p className="text-destructive">{message}</p>
      <p className="text-on-surface-variant mt-1">{detail}</p>
    </div>
  );
}
