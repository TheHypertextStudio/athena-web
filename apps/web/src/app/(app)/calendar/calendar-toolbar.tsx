'use client';

/**
 * `(app)/calendar/calendar-toolbar` — the calendar's single, never-wrapping control row.
 *
 * @remarks
 * This bar used to be `flex flex-wrap` wrapping a second `flex flex-wrap` cluster, and it stacked
 * into four rows the moment `<main>` narrowed: navigation, then a `Dates | People` pill group, then
 * an `Overview | Standard | Detail` pill group, then a zoom slider with a density readout — with
 * the create affordance reflowed onto a fifth line. Five bands of chrome above a grid that had
 * shrunk to 13.92% of the viewport.
 *
 * It is now exactly one row that cannot wrap at any width:
 *
 * ```text
 * [Today] [◀] [▶] [ August 2026 ——— flexible, truncates ]  [Calendars ▾] [People ▾]* [Display ▾] [+ New]
 * ```
 *
 * Three rules hold that shape:
 *
 * - **`flex-nowrap` with one flexible child.** The heading is the only element allowed to give up
 *   width (`min-w-0 flex-1 truncate`); every control is `shrink-0`. Narrowing squeezes the label,
 *   never the layout.
 * - **Controls collapse to their glyph, not to a new line.** Below `@2xl` each trailing control
 *   renders icon-only with an `aria-label`, so four controls cost ~4 × 40px on a phone.
 * - **One control per concern.** Presentation options live inside {@link CalendarViewSettings}, so
 *   a new view capability lands in a menu rather than beside it. Layers and people moved into their
 *   own popovers for the same reason.
 *
 * Sizing is uniform on purpose — inline neighbours must share a height exactly: text controls are
 * `min-h-10 … @2xl:min-h-8`, icon controls `size-10 … @2xl:size-8`, and every glyph is `size-4`
 * (the `Button` base sets `[&_svg]:size-6`, which is far too large here). Breakpoints are
 * `@`-prefixed container queries because `<main>` is a `@container` — the row responds to the
 * space it actually has, not to the window.
 *
 * @see {@link CalendarViewSettings} for the consolidated Display menu.
 * @see {@link calendarRangeLabel} for the heading, the page's single date atom.
 */
import { CalendarToday, ChevronLeft, ChevronRight } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import type { CalendarAxis } from './calendar-schedule-model';
import { CALENDAR_CONTROL_CLASS, CalendarViewSettings } from './calendar-view-settings';

/**
 * Shared geometry for every icon-only control in the row.
 *
 * @remarks
 * Same fluid-with-a-floor rule as {@link CALENDAR_CONTROL_CLASS}: a 40px basis that may compress to
 * 36px when the row is genuinely tight, never below. `flex-nowrap` on the row — not `shrink-0` on
 * the children — is what forbids a second line.
 */
const ROW_ICON_CONTROL =
  'h-10 w-10 min-w-9 shrink [&_svg]:size-4 @2xl:h-8 @2xl:w-8 @2xl:min-w-8 @2xl:shrink-0';

/** Props for {@link TrailingSlot}. */
interface TrailingSlotProps {
  /** The caller-supplied control to pin into the row. */
  readonly children: ReactNode;
}

/**
 * Pin a caller-supplied control into the row as a non-shrinking child.
 *
 * @remarks
 * The one-row guarantee is structural rather than a convention slot authors have to remember: a
 * control handed in as a `ReactNode` cannot be given `shrink-0` from here, so it is wrapped in an
 * element that already has it.
 *
 * @param props - The {@link TrailingSlotProps}.
 * @returns the wrapped control, or nothing when the slot is empty.
 */
function TrailingSlot({ children }: TrailingSlotProps): JSX.Element | null {
  if (children === undefined || children === null) return null;
  return <span className="flex shrink-0 items-center gap-1 @2xl:gap-2">{children}</span>;
}

/** Props for the calendar's navigation, view-settings, and create controls. */
export interface CalendarToolbarProps {
  /** Month/year context for the visible range — never a weekday or an ISO date. */
  readonly heading: string;
  /**
   * The same context abbreviated (`Aug 2026`), shown below `@2xl`.
   *
   * @remarks
   * Truncation is the row's release valve, but a clipped `August 2...` drops the year while an
   * abbreviated month keeps the whole answer. Defaults to {@link CalendarToolbarProps.heading}.
   */
  readonly headingShort?: string;
  /** Which lane axis the canvas is drawing. */
  readonly axis: CalendarAxis;
  /** The live, continuous row height in pixels per hour. */
  readonly pixelsPerHour: number;
  /** The Calendars popover; rendered only on the date axis. */
  readonly layersControl?: ReactNode;
  /** The People popover; rendered only on the people axis. */
  readonly comparisonControl?: ReactNode;
  /** The create affordance; rendered only on the date axis, where creating makes sense. */
  readonly createControl?: ReactNode;
  readonly onToday: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onAxisChange: (axis: CalendarAxis) => void;
  /** Apply a new zoom locally (fires on every step). */
  readonly onZoomChange: (pixelsPerHour: number) => void;
  /** Persist a settled zoom (fires once per deliberate change). */
  readonly onZoomCommit: (pixelsPerHour: number) => void;
}

/**
 * Render the calendar's one control row.
 *
 * @param props - The {@link CalendarToolbarProps}.
 * @returns the toolbar header element.
 */
export function CalendarToolbar({
  heading,
  headingShort,
  axis,
  pixelsPerHour,
  layersControl,
  comparisonControl,
  createControl,
  onToday,
  onPrevious,
  onNext,
  onAxisChange,
  onZoomChange,
  onZoomCommit,
}: CalendarToolbarProps): JSX.Element {
  return (
    <header className="flex min-w-0 shrink-0 flex-nowrap items-center gap-1 @2xl:gap-2">
      {/*
        `Today` follows the same collapse rule as every other labelled control in the row — glyph
        below `@2xl`, word above it. It was the one text button that kept its label at every width,
        which on a 320px row cost 51px the heading needed.
      */}
      <Button
        className={CALENDAR_CONTROL_CLASS}
        size="sm"
        variant="outline"
        aria-label="Today"
        onClick={onToday}
      >
        <CalendarToday className="size-4 @2xl:hidden" aria-hidden="true" />
        <span className="hidden @2xl:inline">Today</span>
      </Button>
      <Button
        className={ROW_ICON_CONTROL}
        size="icon"
        variant="ghost"
        aria-label="Previous dates"
        onClick={onPrevious}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>
      <Button
        className={ROW_ICON_CONTROL}
        size="icon"
        variant="ghost"
        aria-label="Next dates"
        onClick={onNext}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>

      {/*
        The flexible child, but no longer the *only* thing that gives: it holds a `min-w-16` floor —
        enough for `Aug 2026` at the small-title step — and the glyph controls beside it compress
        instead. Below `@2xl` it renders the abbreviated month, which survives the squeeze intact
        where the long form would clip to `August 2...` and lose the year; `title` keeps the full
        month recoverable either way. Both spans are `aria-hidden` and the accessible name comes from
        `aria-label`, so assistive tech reads one unabbreviated heading rather than the two the CSS
        toggles between.
      */}
      <h1
        aria-label={heading}
        title={heading}
        className="text-title-small text-on-surface @sm:text-title-medium min-w-16 flex-1 truncate"
      >
        <span aria-hidden="true" className="@2xl:hidden">
          {headingShort ?? heading}
        </span>
        <span aria-hidden="true" className="hidden @2xl:inline">
          {heading}
        </span>
      </h1>

      {axis === 'dates' ? <TrailingSlot>{layersControl}</TrailingSlot> : null}
      {axis === 'people' ? <TrailingSlot>{comparisonControl}</TrailingSlot> : null}
      <CalendarViewSettings
        axis={axis}
        pixelsPerHour={pixelsPerHour}
        onAxisChange={onAxisChange}
        onZoomChange={onZoomChange}
        onZoomCommit={onZoomCommit}
      />
      {axis === 'dates' ? <TrailingSlot>{createControl}</TrailingSlot> : null}
    </header>
  );
}
