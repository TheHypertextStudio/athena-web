'use client';

/**
 * `timeline` — the two-tier calendar header.
 *
 * @remarks
 * The axis is what makes a timeline readable, and it is exactly what the previous Projects lens
 * lacked: two bare labels in a `justify-between` meant no date could actually be read off the
 * chart. Here the header renders a **major band** (the month, or the year at coarse granularities)
 * over the individual tick labels, so a position resolves to a real date at a glance instead of
 * being interpolated between two endpoints.
 *
 * The header sticks to the top of the scroll container. It is **fully opaque**: it was translucent
 * with a backdrop blur, which meant a row scrolling underneath stayed faintly legible *through*
 * the dates — the smear the launch review caught. Opacity is not a style choice for a sticky
 * element; it is the difference between a header and a watermark.
 *
 * The today rule is drawn through the header so the present stays locatable while scrolling, but
 * it is the header's *own* rule, drawn at the header's z-index — the plot's today rule stops at
 * the top of the plot rather than painting over the dates.
 */
import { cn } from '@docket/ui';
import type { JSX } from 'react';

import { type TimeScale, bandLabel, pct } from './time-scale';

/** One contiguous major band (a month, or a year) spanning several ticks. */
interface Band {
  /** The band's label. */
  readonly label: string;
  /** The band's left edge, as a percentage of the window. */
  readonly left: number;
  /** The band's width, as a percentage of the window. */
  readonly width: number;
}

/**
 * Group consecutive ticks sharing a major-band label into contiguous bands.
 *
 * @remarks
 * The first band is extended back to the window's left edge. The viewport almost never starts
 * exactly on a calendar boundary, so anchoring the first band at the first *tick* would leave a
 * labelless gap at the left — the leading partial month still belongs to that band.
 */
function buildBands(scale: TimeScale): readonly Band[] {
  const bands: Band[] = [];
  for (const tick of scale.ticks) {
    const label = bandLabel(tick.at, scale.granularity);
    const left = pct(tick.at, scale);
    const previous = bands[bands.length - 1];
    if (previous?.label === label) continue;
    if (previous) bands[bands.length - 1] = { ...previous, width: left - previous.left };
    bands.push({ label, left, width: 100 - left });
  }
  const first = bands[0];
  if (first) bands[0] = { ...first, left: 0, width: first.width + first.left };
  return bands;
}

/**
 * How close to the trailing edge a label may start, as a percentage of the window.
 *
 * @remarks
 * A label anchored near the trailing edge has room for a glyph or two before the panel cuts it
 * off, leaving a stray "J" floating in the corner that reads as a rendering fault rather than as a
 * date. Past this point the mark is simply not drawn — the tick's gridline still shows exactly
 * where the boundary is, so nothing is lost but the truncation. Set from the widest label the axis
 * emits (`Q1 '27`) against the narrowest plot the layout permits.
 */
const LABEL_EDGE_LIMIT = 92;

/** Props for {@link TimelineAxis}. */
export interface TimelineAxisProps {
  /** The resolved scale providing ticks and bounds. */
  scale: TimeScale;
  /** The today rule's offset as a percentage, or `null` when today is outside the window. */
  todayLeft: number | null;
}

/**
 * Render the sticky, two-tier calendar header.
 *
 * @param props - The {@link TimelineAxisProps}.
 * @returns the rendered axis header.
 */
export default function TimelineAxis({ scale, todayLeft }: TimelineAxisProps): JSX.Element {
  const bands = buildBands(scale);

  return (
    <div className="relative h-11 select-none">
      {/* Major band — the month, the year, or the decade at coarse granularities. */}
      <div className="relative h-5 overflow-hidden">
        {bands
          .filter((band) => band.left < LABEL_EDGE_LIMIT)
          .map((band) => (
            <div
              key={`${band.label}-${band.left}`}
              className="text-on-surface-variant text-label-small absolute top-0 flex h-full items-center overflow-hidden px-2 whitespace-nowrap"
              style={{ left: `${band.left}%`, width: `${band.width}%` }}
            >
              {band.label}
            </div>
          ))}
      </div>

      {/*
        Tick labels. In a narrow plot area adjacent labels would collide and clip into each other
        ("Jul AugSepO"), so a container query thins them to every other tick — a purely CSS
        response to the *container's* width, with no device check and no breakpoint prop.
      */}
      <div className="@container relative h-6 overflow-hidden">
        {scale.ticks.map((tick, index) => {
          const left = pct(tick.at, scale);
          // Dropped from the tree, not hidden with a class: the thinning rule below re-reveals a
          // hidden label at wide container widths, so a `hidden` here would lose to it.
          if (left >= LABEL_EDGE_LIMIT) return null;
          return (
            <div
              key={tick.at}
              className={cn(
                'text-on-surface-variant text-label-small absolute top-0 flex h-full items-center px-1.5 tabular-nums',
                index % 2 === 1 && 'hidden @[22rem]:flex',
              )}
              style={{ left: `${left}%` }}
            >
              {tick.label}
            </div>
          );
        })}
      </div>

      {todayLeft !== null ? (
        <div
          aria-hidden="true"
          className="bg-primary/60 absolute inset-y-0 z-[1] w-px"
          style={{ left: `${todayLeft}%` }}
          title="Today"
        />
      ) : null}
    </div>
  );
}
