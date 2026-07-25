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
 * The header sticks to the top of the scroll container, and the today rule is drawn through it so
 * the present stays locatable while scrolling in either direction.
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
      {/* Major band — the month, or the year at coarse granularities. */}
      <div className="border-outline-variant relative h-5 border-b">
        {bands.map((band) => (
          <div
            key={`${band.label}-${band.left}`}
            className="text-on-surface-variant absolute top-0 flex h-full items-center overflow-hidden px-2 text-[11px] font-semibold whitespace-nowrap"
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
      <div className="@container relative h-6">
        {scale.ticks.map((tick, index) => (
          <div
            key={tick.at}
            className={cn(
              'text-on-surface-variant absolute top-0 flex h-full items-center px-1.5 text-[11px] tabular-nums',
              index % 2 === 1 && 'hidden @[22rem]:flex',
            )}
            style={{ left: `${pct(tick.at, scale)}%` }}
          >
            {tick.label}
          </div>
        ))}
      </div>

      {todayLeft !== null ? (
        <div
          aria-hidden="true"
          className="bg-primary absolute inset-y-0 z-[1] w-px"
          style={{ left: `${todayLeft}%` }}
          title="Today"
        />
      ) : null}
    </div>
  );
}
