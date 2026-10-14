'use client';

/**
 * The heading of a group of objects, when the heading is itself an object.
 *
 * @remarks
 * A Program holding Projects, a Milestone holding Tasks, an Epic holding its children: the thing at
 * the top of the group is a first-class object you can open, drag and right-click, and it is also
 * the label for everything beneath it. Both facts have to be true at once, which is why this is
 * built on {@link ObjectSurface} — the same behavior primitive {@link ObjectListRow} uses — rather
 * than being a list row with a flag on it.
 *
 * It is deliberately not a denser or bolder `ObjectListRow`. A heading and an item are different
 * things and should not be one component trying to be both: the heading carries the group's type
 * scale and its count, the item carries the row's. Rendering them from the same component is what
 * produced a Program and its Projects at identical size, where nothing on screen said which one
 * contained the other.
 */
import { cn } from '@docket/ui/lib/utils';
import Link from '@/components/docket-link';
import type { JSX, ReactNode } from 'react';

import { ObjectSurface } from '@/components/objects/object-surface';
import { CURSOR_CLICKABLE } from '@/lib/actions/cursor';
import { describeObject, type ObjectActionScope, type ObjectRef } from '@/lib/actions/object';

/** Props for {@link ObjectGroupHeader}. */
export interface ObjectGroupHeaderProps {
  /** The object this group hangs from. */
  readonly object: ObjectRef;
  /** Canonical detail destination for it. */
  readonly href: string;
  /** Optional display icon; falls back to the object's kind glyph. */
  readonly icon?: ReactNode;
  /** What the group is for — the object's own summary, when it has one. */
  readonly description?: ReactNode;
  /**
   * How much this group holds, e.g. "3 projects".
   *
   * @remarks
   * The one fact a heading can state that its own rows cannot: they can be scrolled past, filtered
   * or collapsed, and the count stays true regardless. Omit it rather than rendering a zero — an
   * empty group says so with its own empty state.
   */
  readonly count?: string;
  /** Trailing controls, typically the object's own menu. */
  readonly trailing?: ReactNode;
  /** Prevent movement for read-only or cross-workspace projections. */
  readonly dragDisabled?: boolean;
  /** Restrict the row menu to owner-safe reference actions for a foreign projection. */
  readonly actionScope?: ObjectActionScope;
  /** Selection/list surface recorded as the drag origin. */
  readonly surfaceId?: string;
  /** Additional layout classes for the header root. */
  readonly className?: string;
}

/**
 * Render a group's heading object.
 *
 * @param props - See {@link ObjectGroupHeaderProps}.
 * @returns The heading.
 */
export function ObjectGroupHeader({
  object,
  href,
  icon,
  description,
  count,
  trailing,
  dragDisabled = false,
  actionScope = 'all',
  surfaceId,
  className,
}: ObjectGroupHeaderProps): JSX.Element {
  const DescriptorIcon = describeObject(object.kind).icon;

  return (
    <ObjectSurface
      object={object}
      dragDisabled={dragDisabled}
      actionScope={actionScope}
      {...(surfaceId === undefined ? {} : { surfaceId })}
      href={href}
    >
      <div
        data-testid="object-group-header"
        className={cn(
          'hover:bg-surface-container-high flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors',
          className,
        )}
      >
        <div
          data-testid="object-identity-target"
          aria-hidden={icon === undefined ? 'true' : undefined}
          className="text-on-surface-variant flex shrink-0 items-center justify-center"
        >
          {icon ?? <DescriptorIcon className="size-5" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <Link
              href={href}
              className={cn(
                CURSOR_CLICKABLE,
                'text-on-surface text-title-small min-w-0 truncate outline-none focus-visible:underline',
              )}
            >
              {object.title}
            </Link>
            {count ? (
              <span className="text-on-surface-variant text-label-medium shrink-0 tabular-nums">
                {count}
              </span>
            ) : null}
          </div>
          {description ? (
            <div className="text-on-surface-variant text-body-small truncate">{description}</div>
          ) : null}
        </div>

        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
    </ObjectSurface>
  );
}
