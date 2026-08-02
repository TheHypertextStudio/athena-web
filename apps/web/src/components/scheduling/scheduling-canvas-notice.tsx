import type { JSX } from 'react';

/** Props for {@link SchedulingCanvasNotice}. */
interface SchedulingCanvasNoticeProps {
  /** Guidance shown when every lane is empty. */
  readonly emptyMessage: string;
  /** A read failure to surface instead of the empty-state guidance. */
  readonly error?: string | null;
  /** Whether every visible lane has zero items. */
  readonly isEmpty: boolean;
  /** The visible width of the scroll viewport, so the notice centres on what is on screen. */
  readonly viewportWidth: number;
}

/**
 * Keep degraded and empty-state guidance attached to the visible schedule viewport.
 *
 * @remarks
 * Rendered as the last flow child of the canvas's scrolled content and pinned with
 * `sticky bottom-0`, so it rides the **bottom edge of the visible viewport** at every scroll
 * position while its own height is cancelled by a matching negative margin — it occupies no layout.
 *
 * It used to hang off the sticky lane header (`absolute top-full`) with an opaque
 * `bg-surface/90 backdrop-blur-sm` fill. That put an opaque box exactly where the canvas
 * auto-scrolls the current-time indicator to (one hour below the fold), so the red now-line was
 * chopped into two stubs with a floating paragraph between them, unaligned to any lane. Pinning to
 * the far edge instead puts the notice where nothing else is drawn, and centring it on the viewport
 * — not on the full scrollable content width — keeps it aligned to what the reader can see.
 *
 * @param props - The {@link SchedulingCanvasNoticeProps}.
 * @returns the pinned notice, or nothing when there is neither an error nor an empty canvas.
 */
export function SchedulingCanvasNotice({
  emptyMessage,
  error,
  isEmpty,
  viewportWidth,
}: SchedulingCanvasNoticeProps): JSX.Element | null {
  const normalizedEmptyMessage = emptyMessage.trim();
  const normalizedError = error?.trim();
  const hasError = normalizedError !== undefined && normalizedError.length > 0;
  if (!hasError && (!isEmpty || normalizedEmptyMessage.length === 0)) return null;

  return (
    <div
      className="pointer-events-none sticky bottom-0 left-0 z-40 -mt-20 flex h-20 items-end justify-center px-3 pb-3"
      style={{ width: viewportWidth > 0 ? viewportWidth : undefined }}
    >
      {/*
        Wraps rather than truncates. A one-line clamp reads fine on a desktop canvas and cuts the
        sentence in half on a 390px phone, where this text is the only instruction on the screen —
        the message has to survive the narrow case, and two centred lines is what that costs.
      */}
      <p
        role={hasError ? 'alert' : 'status'}
        className={`text-body-small max-w-full rounded-2xl px-3 py-1.5 text-center text-balance ${
          hasError
            ? 'bg-error-container text-on-error-container font-medium'
            : 'bg-surface-container-high text-on-surface-variant'
        }`}
      >
        {hasError ? normalizedError : normalizedEmptyMessage}
      </p>
    </div>
  );
}
