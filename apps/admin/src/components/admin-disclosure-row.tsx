'use client';

import { ChevronDown, ChevronRight } from '@docket/ui/icons';
import { Button, Text } from '@docket/ui/primitives';
import { type JSX, type ReactNode, useId, useState } from 'react';

/** Props for {@link AdminDisclosureRow}. */
export interface AdminDisclosureRowProps {
  /** The leading identity slot: a glyph, avatar, or status mark. */
  readonly leading?: ReactNode;
  /** The row's primary line. */
  readonly title: ReactNode;
  /** An optional muted second line. */
  readonly subtitle?: ReactNode;
  /** The trailing slot before the toggle — a timestamp, a count. */
  readonly meta?: ReactNode;
  /**
   * What the toggle is called, for its accessible name.
   *
   * @remarks
   * A plain noun phrase naming this row's subject, not a sentence: the component builds
   * "Show <name> detail" and "Hide <name> detail" around it, so every disclosure in the console
   * announces itself the same way.
   */
  readonly name: string;
  /** The disclosed content. Omit it and the row renders no toggle at all. */
  readonly children?: ReactNode;
}

/**
 * One row whose detail opens in place.
 *
 * @remarks
 * The console had this written twice — once for audit events, once for service health — and the two
 * copies had already drifted on their toggle's accessible name and on whether the panel and its
 * trigger were associated at all. Neither wired `aria-controls`, so a screen reader was told a
 * control expands something without being told what.
 *
 * It paints no surface of its own. Its container ({@link AdminList}) already paints the group's
 * card, and a row repeating that tone drew no boundary — three `surface-container-low` layers
 * stacked in the status board, none of them visible. The row separates by rounding and hover tone,
 * exactly as {@link AdminListRow} does, so a disclosure row and a navigable row read as the same
 * family.
 *
 * @param props - See {@link AdminDisclosureRowProps}.
 * @returns the row, and its detail when open.
 */
export function AdminDisclosureRow({
  leading,
  title,
  subtitle,
  meta,
  name,
  children,
}: AdminDisclosureRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="flex flex-col rounded-lg">
      <div className="flex items-center gap-3 px-3 py-2">
        {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <Text as="span" token="body-medium" truncate>
            {title}
          </Text>
          {subtitle ? (
            <Text as="span" token="body-small" tone="muted" truncate>
              {subtitle}
            </Text>
          ) : null}
        </div>

        {meta ? <div className="shrink-0">{meta}</div> : null}

        {children ? (
          <Button
            variant="ghost"
            controlSize="sm"
            iconOnly
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={expanded ? `Hide ${name} detail` : `Show ${name} detail`}
            onClick={() => {
              setExpanded((open) => !open);
            }}
          >
            <Chevron aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
      </div>

      {children ? (
        <div id={panelId} hidden={!expanded} className="px-3 pb-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
