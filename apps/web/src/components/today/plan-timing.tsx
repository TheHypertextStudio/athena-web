/**
 * `today/plan-timing` — when a planned task is scheduled, or how long it should take.
 *
 * @remarks
 * A real clock time beats an estimate whenever one exists — a timebox is a commitment and an
 * estimate is a guess, so showing both would spend two meta slots to say one thing twice. The two
 * carry different glyphs because an estimate reads `h:mm` (`0:30`), which a bare clock time
 * resembles: an alarm clock for when, an hourglass for how long.
 */
import type { HubTodayPlanItem } from '../../lib/contracts/hub';
import { AlarmClock, Hourglass } from '@docket/ui/icons';
import type { JSX } from 'react';

import { formatEstimate } from '@/lib/format-estimate';

/** A planned task's timing, ready to show. */
export interface PlanTiming {
  /** `start` for a scheduled clock time, `estimate` for an expected duration. */
  readonly kind: 'start' | 'estimate';
  /** The formatted time or duration. */
  readonly label: string;
}

/**
 * Resolve a planned task's timing.
 *
 * @param item - The plan item's timebox start and time estimate.
 * @param displayTimezone - The timezone the start time is read in; the device's when omitted.
 * @returns the start time, else the estimate, else `null`.
 */
export function planTiming(
  item: Pick<HubTodayPlanItem, 'timeboxStartsAt' | 'estimateMinutes'>,
  displayTimezone: string | undefined,
): PlanTiming | null {
  if (item.timeboxStartsAt) {
    const label = new Date(item.timeboxStartsAt).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      ...(displayTimezone === undefined ? {} : { timeZone: displayTimezone }),
    });
    return { kind: 'start', label };
  }
  const estimate = formatEstimate(item.estimateMinutes);
  return estimate === null ? null : { kind: 'estimate', label: estimate };
}

/** Props for {@link PlanTimingLabel}. */
export interface PlanTimingLabelProps {
  readonly timing: PlanTiming;
}

/** The timing's glyph and text. */
export function PlanTimingLabel({ timing }: PlanTimingLabelProps): JSX.Element {
  const Glyph = timing.kind === 'start' ? AlarmClock : Hourglass;
  return (
    <>
      <Glyph aria-hidden="true" className="size-3.5" /> {timing.label}
    </>
  );
}
