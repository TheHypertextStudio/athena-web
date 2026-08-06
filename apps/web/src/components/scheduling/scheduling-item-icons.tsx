import type { JSX } from 'react';

/** Six-dot grip used only for direct item movement. */
export function SchedulingGripIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="mx-auto size-4"
      data-schedule-grip-icon=""
      viewBox="0 0 14 14"
      fill="currentColor"
    >
      {[3, 7, 11].flatMap((y) =>
        [4, 10].map((x) => <circle key={`${x}:${y}`} cx={x} cy={y} r="1" />),
      )}
    </svg>
  );
}

/**
 * Closed padlock marking an item this viewer cannot edit.
 *
 * @remarks
 * Drawn here rather than pulled from the shared icon set so its stroke weight matches
 * {@link SchedulingLinkIcon} and {@link SchedulingGripIcon} — the three are the only glyphs that
 * appear on an item card, and a heavier import would read as a different family at 16px.
 */
export function SchedulingLockIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="mx-auto size-4"
      data-schedule-lock-icon=""
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.25" y="7" width="9.5" height="6.5" rx="1.25" />
      <path d="M5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7" />
    </svg>
  );
}

/** Chain-link icon reserved for relationship dragging. */
export function SchedulingLinkIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="mx-auto size-4"
      data-schedule-link-icon=""
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <path d="M6.5 9.5 9.5 6.5" />
      <path d="M5.25 11.75H4.5a3 3 0 0 1 0-6h2" />
      <path d="M10.75 4.25h.75a3 3 0 1 1 0 6h-2" />
    </svg>
  );
}
