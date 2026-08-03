'use client';

/**
 * `(app)/calendar/calendar-view-settings` — the calendar's ONE view-settings control.
 *
 * @remarks
 * This menu replaces four overlapping controls that all wrote the same `pixelsPerHour` scalar and
 * were visible at the same time: a bordered `Overview | Standard | Detail` button group, a
 * `<select>` duplicate of it, an always-exposed `<input type="range">` zoom slider, and an
 * `<output>` that re-derived a density name from the same number. It also absorbs the
 * `Dates | People` axis pill group, so the toolbar spends exactly one trailing control on "how is
 * this drawn" instead of four.
 *
 * The vocabulary is deliberately borrowed, not invented: `views/filter-toolbar.tsx` already solved
 * this problem for every list page ("a surface with more capabilities does not grow more
 * *buttons*"), and its Display trigger recipe is reused verbatim here plus `shrink-0`. MD3 tone and
 * elevation come from `@docket/ui`'s shared `menu-styles` (a `surface-container-low` container with
 * an `outline-variant` hairline) — never a drop shadow added at this layer.
 *
 * ## Zoom model
 *
 * `pixelsPerHour` stays a **continuous, per-user persisted number**; the three named densities are
 * just well-chosen points on it, so nothing about the stored preference shape changes and there is
 * no migration. A trackpad pinch (emitted by the scheduling canvas as a raw scale factor) lands
 * between presets, which the menu reports honestly as `Custom · N%` rather than lighting a radio
 * that does not match.
 *
 * @see {@link CalendarViewSettings}
 * @see {@link clampPixelsPerHour}
 */
import {
  Calendar,
  ChevronDown,
  CircleDashed,
  Minus,
  Plus,
  RefreshCw,
  TuneRounded,
  Users,
} from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

import type { CalendarAxis } from './calendar-schedule-model';

/**
 * The geometry every control in the calendar's one toolbar row carries.
 *
 * @remarks
 * Inline neighbours must share a height exactly, and the row must never wrap (the row itself is
 * `flex-nowrap`, which is what guarantees that — not `shrink-0`). Below `@2xl` a trailing control
 * collapses to a glyph-only square. `px-2` overrides the `size="sm"` recipe's `px-3` at that width
 * and is restored above it; breakpoints are container queries because `<main>` is the `@container`,
 * so the row responds to the space it actually has rather than to the window.
 *
 * ## Three widths, and the arithmetic each one has to satisfy
 *
 * The row is six controls plus a heading, and its width budget is the only thing standing between
 * this surface and a primary action that falls off the screen — which is exactly what happened: at
 * 320px the `New` button's right edge measured 324px in a 320px viewport, its border visibly cut.
 * So the sizes are chosen against the arithmetic, per container step, rather than as one fluid rule:
 *
 * | viewport | container      | control | gap | row budget | controls + gaps | left for the heading |
 * | -------- | -------------- | ------- | --- | ---------- | --------------- | -------------------- |
 * | 320      | 309 (`< 22rem`)| 36px    | 2px | 293px      | 226px           | 67px (`Aug 2026`)    |
 * | 375      | 364 (`@22rem`) | 44px    | 2px | 348px      | 274px           | 74px (`Aug 2026`)    |
 * | 390      | 379 (`@22rem`) | 44px    | 2px | 363px      | 274px           | 89px (`Aug 2026`)    |
 * | ≥ 672    | `@2xl`         | 32px    | 8px | ≥ 600px    | labels + gaps   | the remainder        |
 *
 * The 44px middle step is not decoration: below `@2xl` every control is icon-only, and a phone-width
 * calendar has to offer real touch targets — 44 × 44 CSS px is the floor a finger needs. The step
 * begins at a 22rem *container* rather than at `@sm` (24rem) because `<main>` reserves a stable
 * scrollbar gutter, so a 390px phone reports a 379px container and would otherwise miss `@sm`
 * entirely — the exact off-by-a-gutter that left a phone with 36px targets. The 36px bottom step is
 * the concession 320px forces, on a width no touch device actually reports.
 *
 * `[&_svg]:size-4` is required, not decorative: `Button`'s base recipe sets `[&_svg]:size-6`, whose
 * descendant selector outranks a plain `size-4` on the glyph itself, so a 24px icon would sit in a
 * 32px control. Overriding at the same specificity — `cn` merges `className` last — is what actually
 * lands the intended 16px glyph.
 *
 * `create-block-form.tsx` repeats this literal rather than importing it, because a `components/`
 * module must not depend on an `app/` route module.
 */
export const CALENDAR_CONTROL_CLASS =
  'min-h-9 w-9 min-w-9 shrink gap-1.5 px-2 [&_svg]:size-4 @min-[22rem]:min-h-11 @min-[22rem]:w-11 @min-[22rem]:min-w-11 @2xl:min-h-8 @2xl:w-auto @2xl:min-w-8 @2xl:shrink-0 @2xl:px-3';

/** Smallest legal zoom — roughly a full day in view without the grid collapsing. */
export const MIN_PIXELS_PER_HOUR = 24;
/** Largest legal zoom — fine enough to place a five-minute block by hand. */
export const MAX_PIXELS_PER_HOUR = 240;
/** The one sane default density every new viewer starts at, and the `100%` zoom reference. */
export const DEFAULT_PIXELS_PER_HOUR = 72;

/**
 * The only named densities the product exposes.
 *
 * @remarks
 * Three points on the continuous `pixelsPerHour` scale. They are not a separate persisted enum —
 * picking one simply writes its number — which is why a pinch that lands between them is a legal
 * state rather than a broken one.
 */
export const CALENDAR_DENSITY_PRESETS = [
  { id: 'compact', label: 'Compact', pixelsPerHour: 48 },
  { id: 'default', label: 'Default', pixelsPerHour: DEFAULT_PIXELS_PER_HOUR },
  { id: 'spacious', label: 'Spacious', pixelsPerHour: 108 },
] as const;

/** Identifier of one {@link CALENDAR_DENSITY_PRESETS} entry. */
export type CalendarDensityPresetId = (typeof CALENDAR_DENSITY_PRESETS)[number]['id'];

/** Radio value used when the continuous zoom matches no named preset. */
const CUSTOM_DENSITY = '__custom__';

/** Multiplier applied by one press of the zoom-in step. */
const ZOOM_STEP_IN = 1.25;
/** Multiplier applied by one press of the zoom-out step — the inverse-ish of {@link ZOOM_STEP_IN}. */
const ZOOM_STEP_OUT = 0.8;

/**
 * Clamp and round any proposed zoom to a legal, persistable pixels-per-hour value.
 *
 * @remarks
 * The single funnel every zoom source flows through — preset, stepper, reset, and the canvas's raw
 * pinch scale — so no code path can persist an out-of-range or fractional height. Non-finite input
 * (a `NaN` from a degenerate gesture, say) resolves to {@link DEFAULT_PIXELS_PER_HOUR} rather than
 * propagating into layout math.
 *
 * @param value - The proposed pixels-per-hour, from any source.
 * @returns an integer within `[MIN_PIXELS_PER_HOUR, MAX_PIXELS_PER_HOUR]`.
 *
 * @example
 * ```ts
 * clampPixelsPerHour(71.4);      // 71
 * clampPixelsPerHour(1_000);     // 240
 * clampPixelsPerHour(Number.NaN); // 72
 * ```
 */
export function clampPixelsPerHour(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PIXELS_PER_HOUR;
  return Math.min(MAX_PIXELS_PER_HOUR, Math.max(MIN_PIXELS_PER_HOUR, Math.round(value)));
}

/**
 * Render the inline leading glyph for a density preset.
 *
 * @remarks
 * `−` / `○` / `+` reads as one less-neutral-more progression. The neutral glyph is an **open ring**
 * rather than a filled dot because Radix draws the row's selected indicator as a small filled
 * circle in the left gutter — two solid dots on the same row read as one control repeated, not as
 * an indicator plus an icon.
 *
 * @param id - Which preset the row represents.
 * @returns the icon element, sized to the menu's `size-4` leading-icon slot.
 */
function densityIcon(id: CalendarDensityPresetId): JSX.Element {
  if (id === 'compact') return <Minus className="size-4" aria-hidden="true" />;
  if (id === 'spacious') return <Plus className="size-4" aria-hidden="true" />;
  return <CircleDashed className="size-4" aria-hidden="true" />;
}

/** Props for {@link CalendarViewSettings}. */
export interface CalendarViewSettingsProps {
  /** Which lane axis the canvas is drawing. */
  readonly axis: CalendarAxis;
  /** The live, continuous row height in pixels per hour. */
  readonly pixelsPerHour: number;
  /** Switch the canvas between date lanes and person lanes. */
  readonly onAxisChange: (axis: CalendarAxis) => void;
  /** Apply a new zoom locally (fires on every step). */
  readonly onZoomChange: (pixelsPerHour: number) => void;
  /** Persist a settled zoom (fires once per deliberate change). */
  readonly onZoomCommit: (pixelsPerHour: number) => void;
}

/**
 * The calendar's consolidated Display menu: lane axis, density, zoom, and reset.
 *
 * @remarks
 * Every affordance lives inside the menu, so the page surfaces exactly one zoom control and the
 * toolbar row keeps a fixed width budget no matter how many view capabilities the calendar grows.
 *
 * The zoom stepper is a non-closing row: its `onSelect` is prevented so a press adjusts the value
 * without dismissing the menu, and `ArrowLeft`/`ArrowRight` step it from the keyboard (Radix owns
 * `ArrowUp`/`ArrowDown` for row navigation, and a menu traps `Tab`, so the nested step buttons are
 * pointer targets rather than tab stops). The readout is `aria-live="polite"`, so each step is
 * announced.
 *
 * @param props - The {@link CalendarViewSettingsProps}.
 * @returns the Display trigger and its menu.
 *
 * @example
 * ```tsx
 * <CalendarViewSettings
 *   axis={axis}
 *   pixelsPerHour={pixelsPerHour}
 *   onAxisChange={setAxis}
 *   onZoomChange={setPixelsPerHour}
 *   onZoomCommit={persist}
 * />
 * ```
 */
export function CalendarViewSettings({
  axis,
  pixelsPerHour,
  onAxisChange,
  onZoomChange,
  onZoomCommit,
}: CalendarViewSettingsProps): JSX.Element {
  const activePreset = CALENDAR_DENSITY_PRESETS.find(
    (preset) => preset.pixelsPerHour === pixelsPerHour,
  );
  const zoomPercent = Math.round((pixelsPerHour / DEFAULT_PIXELS_PER_HOUR) * 100);
  const canZoomOut = pixelsPerHour > MIN_PIXELS_PER_HOUR;
  const canZoomIn = pixelsPerHour < MAX_PIXELS_PER_HOUR;

  /** Apply and persist one deliberate zoom change, clamped to the legal range. */
  function applyZoom(value: number): void {
    const next = clampPixelsPerHour(value);
    onZoomChange(next);
    onZoomCommit(next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Display settings"
          className={CALENDAR_CONTROL_CLASS}
        >
          <TuneRounded className="size-4" aria-hidden="true" />
          <span className="hidden @2xl:inline">Display</span>
          <ChevronDown className="hidden size-4 opacity-60 @2xl:inline" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[15rem]">
        <DropdownMenuLabel>View</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={axis}
          onValueChange={(next) => {
            onAxisChange(next as CalendarAxis);
          }}
        >
          <DropdownMenuRadioItem value="dates">
            <Calendar className="size-4" aria-hidden="true" />
            Dates
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="people">
            <Users className="size-4" aria-hidden="true" />
            People
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Density</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={activePreset?.id ?? CUSTOM_DENSITY}
          onValueChange={(next) => {
            const preset = CALENDAR_DENSITY_PRESETS.find((candidate) => candidate.id === next);
            if (preset) applyZoom(preset.pixelsPerHour);
          }}
        >
          {CALENDAR_DENSITY_PRESETS.map((preset) => (
            <DropdownMenuRadioItem key={preset.id} value={preset.id}>
              {densityIcon(preset.id)}
              {preset.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {/*
          A pinch lands between presets. Report that as a quiet, non-selectable hint rather than a
          fourth radio — "Custom" is a description of the current number, not a thing to pick.
        */}
        {activePreset ? null : (
          <DropdownMenuLabel className="text-body-medium">
            Custom · {zoomPercent}%
          </DropdownMenuLabel>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="justify-start"
          onSelect={(event) => {
            event.preventDefault();
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            applyZoom(pixelsPerHour * (event.key === 'ArrowRight' ? ZOOM_STEP_IN : ZOOM_STEP_OUT));
          }}
        >
          <span className="text-body-medium text-on-surface">Zoom</span>
          <span className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tabIndex={-1}
              aria-label="Zoom out"
              className="size-8 [&_svg]:size-4"
              disabled={!canZoomOut}
              onClick={() => {
                applyZoom(pixelsPerHour * ZOOM_STEP_OUT);
              }}
            >
              <Minus className="size-4" aria-hidden="true" />
            </Button>
            <span
              aria-live="polite"
              className="text-label-medium text-on-surface-variant w-12 text-center tabular-nums"
            >
              {zoomPercent}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tabIndex={-1}
              aria-label="Zoom in"
              className="size-8 [&_svg]:size-4"
              disabled={!canZoomIn}
              onClick={() => {
                applyZoom(pixelsPerHour * ZOOM_STEP_IN);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
            </Button>
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => {
            applyZoom(DEFAULT_PIXELS_PER_HOUR);
          }}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Reset to default
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
