'use client';

/**
 * `teams` — the band across the top of a team card.
 *
 * @remarks
 * A team either has an uploaded cover or it does not, and the second case is the one worth
 * designing for. A workspace that has just created six teams has uploaded nothing, and a grid of
 * six empty rectangles is worse than the list it replaced — so the fallback is not an empty state,
 * it is a cover *derived* from the team's own icon and color. The grid looks composed on the first
 * day, and uploading becomes an improvement rather than a chore standing between a workspace and a
 * usable screen.
 *
 * The derived cover is deterministic: same icon and color, same picture, every render and every
 * reload. Nothing here is random, because a cover that shuffled on reload would read as a bug.
 */
import type { EntityDisplayOut } from '@docket/work/entity-display-contract';
import { STRATEGIC_WORK_ROUNDED_ICON_BY_KEY } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

import { ENTITY_DISPLAY_COLOR_BY_KEY } from '@/components/entity-display/entity-icon-glyph';

/** Props for {@link TeamCover}. */
export interface TeamCoverProps {
  /** The team's display metadata — its icon, color, and any uploaded cover. */
  display: EntityDisplayOut;
  /** The team name, used for the uploaded image's alt text. */
  teamName: string;
  /** Extra classes merged onto the cover band. */
  className?: string;
}

/**
 * The cover band: an uploaded image when there is one, otherwise a derived wash.
 *
 * @param props - The {@link TeamCoverProps}.
 * @returns the rendered cover.
 */
export function TeamCover({ display, teamName, className }: TeamCoverProps): JSX.Element {
  if (display.coverImage !== null) {
    return (
      <div className={cn('bg-surface-container relative overflow-hidden', className)}>
        <img
          src={display.coverImage}
          alt={`${teamName} cover`}
          className="size-full object-cover"
        />
      </div>
    );
  }

  const color = ENTITY_DISPLAY_COLOR_BY_KEY[display.colorKey];
  const Icon = STRATEGIC_WORK_ROUNDED_ICON_BY_KEY[display.iconKey];
  const hasCustomColor = display.customColor !== null;

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden bg-gradient-to-br',
        !hasCustomColor && color.coverClass,
        className,
      )}
      style={
        hasCustomColor
          ? {
              backgroundImage: `linear-gradient(to bottom right, ${display.customColor}40, transparent)`,
            }
          : undefined
      }
    >
      {/* The team's icon again, blown up far past legibility and bled off two edges so it reads as
          texture rather than as a second, competing copy of the glyph. At 20% it was recognizable
          enough to look like a mistake; the point is a silhouette that makes the grid scannable by
          shape and color before any text is read. */}
      <Icon
        aria-hidden="true"
        className={cn(
          'absolute -top-8 -right-10 size-44 opacity-[0.12]',
          !hasCustomColor && color.iconClass,
        )}
        style={hasCustomColor ? { color: display.customColor ?? undefined } : undefined}
      />
    </div>
  );
}

export default TeamCover;
