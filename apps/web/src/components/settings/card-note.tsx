import { InlineBanner } from '@docket/ui/components';
import type { JSX, ReactNode } from 'react';

/** Props for {@link CardNote}. */
export interface CardNoteProps {
  /**
   * `error` presents the note as a critical banner that announces itself; `muted` is a quiet
   * notice.
   */
  tone: 'error' | 'muted';
  /**
   * The banner heading for an `error` note. Application-owned copy naming the state the card is
   * in; the children carry the explanation.
   */
  title?: string | undefined;
  children: ReactNode;
}

/** The heading an `error` note takes when the caller names none. */
const NEEDS_ATTENTION = 'Needs attention';

/**
 * A footer note beneath an integration card's header (a persistent problem or an info notice).
 *
 * @remarks
 * Shared by the generic provider card and the Google Tasks rows so the tonal-step footer
 * (`bg-surface-container`, no divider border) reads identically everywhere. An `error` note is a
 * state the card is in rather than a failed action, so it renders as an `InlineBanner` in the
 * card; a failed write is presented as a notice by the mutation that made it.
 */
export function CardNote({ tone, title, children }: CardNoteProps): JSX.Element {
  if (tone === 'error') {
    return <CardAlert message={title ?? NEEDS_ATTENTION} detail={children} />;
  }
  return (
    <p className="text-on-surface-variant bg-surface-container text-body-small px-4 py-2">
      {children}
    </p>
  );
}

/** Props for {@link CardAlert}. */
export interface CardAlertProps {
  /** The banner heading: what state the connection is in. */
  message: string;
  /** The explanation and the recommended recovery. */
  detail: ReactNode;
  /** The recovery control, for surfaces that can offer one. */
  action?: ReactNode;
}

/**
 * A persistent alert footer: a critical banner with a heading, an explanation, and a recovery
 * control.
 *
 * @remarks
 * Used for server-truth connection errors that survive reload (never ephemeral state). The copy
 * differs per surface, so callers pass it in; only the banner layout is shared here.
 */
export function CardAlert({ message, detail, action }: CardAlertProps): JSX.Element {
  return (
    <div className="bg-surface-container px-4 py-2">
      <InlineBanner tone="critical" density="compact" title={message}>
        {detail}
        {action ? <div className="mt-2 flex flex-wrap items-center gap-2">{action}</div> : null}
      </InlineBanner>
    </div>
  );
}
