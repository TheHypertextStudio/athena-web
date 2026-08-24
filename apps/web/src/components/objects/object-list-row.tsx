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
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { ObjectSurface } from '@/components/objects/object-surface';
import { CURSOR_CLICKABLE } from '@/lib/actions/cursor';
import { describeObject, type ObjectRef } from '@/lib/actions/object';

/** Props for {@link ObjectListRow}. */
export interface ObjectListRowProps {
  /** The canonical identity and interaction context. */
  readonly object: ObjectRef;
  /** Canonical detail destination for the object. */
  readonly href: string;
  /** Optional display icon; falls back to the object's kind glyph. */
  readonly icon?: ReactNode;
  /** Useful secondary context, never a decorative count. */
  readonly description?: ReactNode;
  /** Optional trailing state or relationship label. */
  readonly trailing?: ReactNode;
  /** Prevent movement for read-only or cross-workspace projections. */
  readonly dragDisabled?: boolean;
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
  dragDisabled = false,
  surfaceId,
  className,
}: ObjectListRowProps): JSX.Element {
  const DescriptorIcon = describeObject(object.kind).icon;

  return (
    <ObjectSurface object={object} dragDisabled={dragDisabled} surfaceId={surfaceId} href={href}>
      <div
        data-testid="object-list-row"
        className={cn(
          'bg-surface-container-low hover:bg-surface-container-high flex min-h-16 items-center gap-3 rounded-xl px-3 py-2 transition-colors',
          className,
        )}
      >
        <div
          data-testid="object-identity-target"
          aria-hidden="true"
          className="bg-surface-container-high text-on-surface-variant flex size-10 shrink-0 items-center justify-center rounded-lg"
        >
          {icon ?? <DescriptorIcon className="size-5" />}
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
            <div className="text-on-surface-variant text-body-small mt-0.5 truncate">
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
