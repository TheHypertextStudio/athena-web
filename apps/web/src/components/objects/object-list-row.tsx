'use client';

/**
 * The standard compact list representation of a first-class Docket object.
 *
 * @remarks
 * Relationship collections and overview lists share this composition so an object does not lose
 * identity or capability when the surrounding page changes. The row owns only arrangement; the
 * {@link ObjectSurface} owns object behavior.
 */
import { cn } from '@docket/ui/lib/utils';
import Link from '@/components/docket-link';
import type { JSX, ReactNode } from 'react';

import { ObjectSurface } from '@/components/objects/object-surface';
import { CURSOR_CLICKABLE } from '@/lib/actions/cursor';
import { describeObject, type ObjectActionScope, type ObjectRef } from '@/lib/actions/object';

/** Props for {@link ObjectListRow}. */
export interface ObjectListRowProps {
  /** The canonical identity and interaction context. */
  readonly object: ObjectRef;
  /** Canonical detail destination for the object. */
  readonly href: string;
  /** Optional display icon; falls back to the object's kind glyph. */
  readonly icon?: ReactNode;
  /**
   * How much room the row takes.
   *
   * @remarks
   * `comfortable` is the standalone row: a 40px identity tile and a 64px minimum, which is right
   * when a handful of rows are the page. `compact` is for a nested list, where that tile pushes
   * the name past half the column on a phone and the rows are read as a group rather than as
   * cards. Compact drops the tile to a bare glyph and the row to its content height.
   */
  readonly density?: 'comfortable' | 'compact';
  /** Useful secondary context, never a decorative count. */
  readonly description?: ReactNode;
  /** Optional trailing state or relationship label. */
  readonly trailing?: ReactNode;
  /** Prevent movement for read-only or cross-workspace projections. */
  readonly dragDisabled?: boolean;
  /** Restrict the row menu to owner-safe reference actions when this is a foreign projection. */
  readonly actionScope?: ObjectActionScope;
  /** Selection/list surface recorded as the drag origin. */
  readonly surfaceId?: string;
  /** Additional layout classes for the row root. */
  readonly className?: string;
}

/**
 * Render a navigable, right-clickable, handle-free draggable object row.
 *
 * @param props - The object and its context-specific supporting content.
 * @returns The standard row composition.
 */
export function ObjectListRow({
  object,
  href,
  icon,
  description,
  trailing,
  density = 'comfortable',
  dragDisabled = false,
  actionScope = 'all',
  surfaceId,
  className,
}: ObjectListRowProps): JSX.Element {
  const DescriptorIcon = describeObject(object.kind).icon;

  return (
    <ObjectSurface
      object={object}
      dragDisabled={dragDisabled}
      actionScope={actionScope}
      surfaceId={surfaceId}
      href={href}
    >
      <div
        data-testid="object-list-row"
        data-density={density}
        className={cn(
          'bg-surface-container-low hover:bg-surface-container-high flex items-center transition-colors',
          density === 'compact'
            ? 'min-h-0 gap-2 rounded-lg px-2 py-1.5'
            : 'min-h-16 gap-3 rounded-xl px-3 py-2',
          className,
        )}
      >
        <div
          data-testid="object-identity-target"
          aria-hidden={icon === undefined ? 'true' : undefined}
          className={cn(
            'text-on-surface-variant flex shrink-0 items-center justify-center',
            density === 'compact' ? '' : 'bg-surface-container-high size-10 rounded-lg',
          )}
        >
          {icon ?? <DescriptorIcon className={density === 'compact' ? 'size-4' : 'size-5'} />}
        </div>

        <div className="min-w-0 flex-1">
          <Link
            href={href}
            className={cn(
              CURSOR_CLICKABLE,
              'text-on-surface text-body-medium block truncate font-medium outline-none focus-visible:underline',
            )}
          >
            {object.title}
          </Link>
          {description ? (
            <div
              className={cn(
                'text-on-surface-variant text-body-small truncate',
                density === 'compact' ? '' : 'mt-0.5',
              )}
            >
              {description}
            </div>
          ) : null}
        </div>

        {trailing ? (
          <div className="text-on-surface-variant text-body-small shrink-0">{trailing}</div>
        ) : null}
      </div>
    </ObjectSurface>
  );
}
