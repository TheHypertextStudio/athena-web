'use client';

/**
 * `stream` — the timeline spine: the hairline rail and the station marks that sit on it.
 *
 * @remarks
 * Stream used to separate its regions with borders — a `border-b` between episodes, a `divide-y`
 * between event lines, a `border-l` on the disclosed related list. The design system's answer is
 * the opposite one (`docs/design/design-system.md` §8): a tonal step separates two regions, and a
 * line is reserved for a genuine semantic boundary. A timeline's rail *is* that boundary — it
 * says "these events are one continuous sequence" — so it is the one line the surface keeps, and
 * every other border goes away.
 *
 * ## Why the rail is per-row rather than one long element
 *
 * A single rail spanning the episode would have to know where the first row starts and the last
 * one ends, which is a measurement, and every mark on it would then need an absolute offset
 * computed against that same origin. Instead each row draws its own segment across its own full
 * height; consecutive segments butt together and read as one continuous line. Nothing measures
 * anything, and disclosing the related events simply adds more segments — which is exactly the
 * behaviour the design wants ("the timeline extends downward" rather than "a second, indented
 * list appears").
 *
 * ## Why there are no offset magic numbers
 *
 * The rail centres itself with `left-1/2 -translate-x-1/2` and the mark centres itself with the
 * cell's `justify-center`. Both resolve against the same box, so they cannot drift by the half
 * pixel that hand-computed offsets always produce against a 1px line. The only tuned number in
 * the file is the mark's vertical position, and it is derived rather than nudged: 15px is the
 * optical centre of a `body-medium` (14/20) first line inside a `min-h-10 py-2` row — 8px of
 * padding plus half of the 20px line box, less half of the 6px mark.
 *
 * The one number this file does *not* own is the width of the column it sits in: rows spell
 * `grid-cols-[1.25rem_…]` out literally because Tailwind's scanner reads class strings, not
 * constants, so a shared `SPINE_COLUMN` export would emit no CSS while looking like the source of
 * truth. The cell fills whatever track it is given and centres itself inside it, so a row that got
 * the width wrong shows it immediately rather than drifting by a pixel.
 */
import { ChevronDown } from '@docket/ui/icons';
import { cn } from '@docket/ui';
import type { JSX } from 'react';

/** The station kinds that can sit on the rail. */
export type SpineMark = 'event' | 'related' | 'toggle' | 'none';

/** Props for {@link SpineCell}. */
export interface SpineCellProps {
  /**
   * Which station this row is.
   *
   * @remarks
   * `event` is a filled dot — a substantive event, stated explicitly. `related` is a hollow ring
   * — an event that was demoted behind the episode's disclosure, so it reads as "you asked to
   * see this" rather than "we are telling you this". `toggle` is the disclosure itself, drawn as
   * a chevron node so the thing that *reveals* stations does not look like a station. `none`
   * draws rail only, for a row that continues the sequence without being an event.
   */
  readonly mark: SpineMark;
  /** Whether the disclosure this cell marks is open (rotates the `toggle` chevron). */
  readonly open?: boolean;
  /**
   * Stop the rail halfway down this row.
   *
   * @remarks
   * Set on the last row of a group so the line terminates at its final station instead of
   * running into the whitespace below it.
   */
  readonly terminal?: boolean;
}

/**
 * One row's segment of the spine, with its station mark.
 *
 * @param props - See {@link SpineCellProps}.
 * @returns A decorative cell; the caller places it as the row's leading grid track.
 */
export function SpineCell({ mark, open = false, terminal = false }: SpineCellProps): JSX.Element {
  return (
    <span aria-hidden="true" className="relative flex h-full justify-center">
      <span
        className={cn(
          'bg-outline-variant absolute top-0 left-1/2 w-px -translate-x-1/2',
          terminal ? 'h-[0.9375rem]' : 'bottom-0',
        )}
      />
      {mark === 'toggle' ? (
        <span className="bg-surface-container-low text-on-surface-variant relative mt-2 flex size-4 items-center justify-center rounded-full">
          <ChevronDown
            className={cn('size-3 transition-transform ease-(--ease-out)', open && 'rotate-180')}
          />
        </span>
      ) : mark === 'none' ? null : (
        <span
          className={cn(
            'relative mt-[0.9375rem] size-1.5 shrink-0 rounded-full',
            mark === 'event' ? 'bg-outline' : 'ring-outline bg-surface-container-low ring-1',
          )}
        />
      )}
    </span>
  );
}
