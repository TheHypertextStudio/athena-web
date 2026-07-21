'use client';

/**
 * `@docket/ui` — the canonical, customizable entity list-row primitive.
 *
 * @remarks
 * Docket's workhorse surface is the dense, scannable *row*, not a card grid (see the
 * design-system spec §5.1). {@link EntityListRow} is the composable row every entity list
 * (Projects, Programs, Teams, Cycles, …) renders, so tasks and entities share one row
 * vocabulary: a leading glyph/avatar/ring, a title that flexes and truncates, an optional
 * subtitle, a flexible band of inline metadata, and a trailing slot whose contents can be
 * revealed on hover.
 *
 * It deliberately mirrors {@link ListRow}'s MD3 surface treatment — the hairline
 * `border-outline-variant` divider, `hover:bg-surface-container-high`, the
 * `bg-surface-container-highest` active tone, the `bg-secondary-container` selected tone, and
 * the inset `focus-visible` ring —
 * so a virtualized {@link ListView} of tasks and a plain list of entities read as the same
 * component family. Density follows the shared row rhythm (`min-h-9`, `px-3`, `py-1.5`, `gap-2`).
 *
 * The row is polymorphic over its activation affordance: pass `href` to render a real
 * `<a>` (keyboard-operable, right-clickable, prefetchable by a router `Link` slot), or omit
 * it to render a `<button>` that calls `onActivate`. Either way the whole row is one focusable
 * target with a visible focus ring, and the trailing actions stay clickable without triggering
 * the row (their own `stopPropagation`/`preventDefault` is the caller's responsibility).
 *
 * Callers choose which metadata to surface — every slot is optional — which is what makes the
 * row *customizable* per entity without a bespoke component each time.
 */
import * as React from 'react';

import { cn } from '../../lib/utils';
import { focusRingInset } from '../../primitives/focus';

import { EntityListToneContext } from './entity-list-row-slots';
import type {
  EntityListProps,
  EntityListTone,
  RowMetaProps,
  RowProgressProps,
} from './entity-list-row-slots';
export { EntityList, EntityListToneContext, RowMeta, RowProgress } from './entity-list-row-slots';
export type { EntityListProps, EntityListTone, RowMetaProps, RowProgressProps };

/** Props for {@link EntityListRow}. */
export interface EntityListRowProps {
  /**
   * The leading slot: a status glyph, type icon, avatar, or progress ring. Fixed-width and
   * vertically centered; omit for a flush title.
   */
  leading?: React.ReactNode;
  /**
   * The primary line. A plain string is rendered as a truncating, single-line title; pass a
   * node to fully control the title row (e.g. a key chip beside the name).
   */
  title: React.ReactNode;
  /**
   * An optional secondary line beneath the title (e.g. a date window or description),
   * rendered muted and truncated. Omit to keep the row single-line.
   */
  subtitle?: React.ReactNode;
  /**
   * Inline metadata shown in the flexible band after the title: chips, lead avatars, dates,
   * counts, or a thin progress bar. Each entry is wrapped so callers pass raw nodes; the band
   * is hidden entirely when empty. Order is preserved.
   */
  meta?: React.ReactNode;
  /**
   * The trailing slot, pinned to the row's end: a status badge, secondary count, or actions.
   * Combine with {@link EntityListRowProps.revealTrailingOnHover} to reveal hover actions.
   */
  trailing?: React.ReactNode;
  /**
   * When set, render an `<a href>` instead of a `<button>` so the row is a real link
   * (right-clickable, openable in a new tab). `onActivate` still fires on plain activation.
   */
  href?: string;
  /**
   * Render via a custom element — typically a router `Link`. Receives the same `className`,
   * `href`, and activation handlers; use with {@link EntityListRowProps.href}.
   */
  render?: (props: EntityRowRenderProps) => React.ReactNode;
  /** Activate (open) the row — fired on click and Enter. */
  onActivate?: () => void;
  /**
   * Whether the row is interactive. Defaults to `true` — the row renders a focusable
   * `<button>`/`<a>` that opens its target. Set `false` for a presentational row that has no
   * destination yet.
   */
  interactive?: boolean;
  /** Whether the row is the active (keyboard-focused) row in a roving-tabindex list. */
  active?: boolean;
  /** Whether the row is selected. */
  selected?: boolean;
  /** Tab index for roving-tabindex keyboard navigation; defaults to `0` (standalone lists). */
  tabIndex?: number;
  /**
   * Reveal the trailing slot only on row hover / focus-within (Linear-style row actions).
   * Defaults to `false` (trailing content is always visible).
   */
  revealTrailingOnHover?: boolean;
  /** Accessible label for the row when the title alone is not descriptive. */
  'aria-label'?: string;
  /** Extra classes merged onto the row element. */
  className?: string;
}

/** The props an {@link EntityListRowProps.render} slot receives. */
export interface EntityRowRenderProps {
  className: string;
  href?: string;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  tabIndex: number;
  'aria-current': 'true' | undefined;
  children: React.ReactNode;
}

const ROW_BASE =
  '@container/row group/row relative flex min-h-(--row-h) w-full items-center gap-2 px-3 py-(--row-py) text-left text-body-medium';

/** Separation classes per tone: hairline dividers when bordered, rounded rows when tonal. */
const ROW_TONE: Record<EntityListTone, string> = {
  bordered: 'border-outline-variant border-b last:border-b-0',
  tonal: 'rounded-lg',
};

const ROW_INTERACTIVE = cn(
  'cursor-pointer transition-colors outline-none hover:bg-surface-container-high focus-visible:bg-surface-container-high',
  focusRingInset,
);

/**
 * The canonical, customizable entity list row.
 *
 * @remarks
 * Composes the leading / title / subtitle / meta / trailing slots into one dense, keyboard-
 * operable row. Renders a `<button>` by default, an `<a>` when `href` is set, or a fully
 * custom element via `render` (e.g. a Next.js `Link`); pass `interactive={false}` for an inert
 * presentational `<div>` row. Selection adopts the MD3 `bg-secondary-container` tone while the
 * active (keyboard-focused) state uses `bg-surface-container-highest`, matching {@link ListRow}.
 *
 * @example
 * ```tsx
 * <EntityListRow
 *   leading={<StatusIcon type="started" />}
 *   title="Billing revamp"
 *   meta={<><RowMeta><ActorAvatar kind="human" name="Ada" size={18} /> Ada</RowMeta></>}
 *   trailing={<Badge>Active</Badge>}
 *   onActivate={() => open(project.id)}
 * />
 * ```
 */
export function EntityListRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  href,
  render,
  onActivate,
  interactive = true,
  active = false,
  selected = false,
  tabIndex = 0,
  revealTrailingOnHover = false,
  'aria-label': ariaLabel,
  className,
}: EntityListRowProps): React.JSX.Element {
  const tone = React.useContext(EntityListToneContext);

  const handleClick = React.useCallback(() => {
    onActivate?.();
  }, [onActivate]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') {
        if (href === undefined) {
          event.preventDefault();
          onActivate?.();
        }
      }
    },
    [href, onActivate],
  );

  const rowClassName = cn(
    ROW_BASE,
    ROW_TONE[tone],
    interactive && ROW_INTERACTIVE,
    // Explicit selection takes the indigo tonal fill; the roving keyboard cursor stays neutral.
    selected && 'bg-secondary-container',
    active && !selected && 'bg-surface-container-highest',
    className,
  );

  const body = (
    <>
      {leading !== undefined && leading !== null ? (
        <span className="flex shrink-0 items-center self-start pt-px">{leading}</span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-on-surface flex min-w-0 items-center gap-2 truncate font-medium">
          {title}
        </span>
        {subtitle !== undefined && subtitle !== null ? (
          <span className="text-on-surface-variant min-w-0 truncate text-xs">{subtitle}</span>
        ) : null}
      </span>
      {meta !== undefined && meta !== null ? (
        <span className="text-on-surface-variant hidden shrink-0 items-center gap-x-4 gap-y-1 text-xs @md/row:flex">
          {meta}
        </span>
      ) : null}
      {trailing !== undefined && trailing !== null ? (
        <span
          className={cn(
            'flex shrink-0 items-center gap-2',
            revealTrailingOnHover &&
              'opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100',
          )}
        >
          {trailing}
        </span>
      ) : null}
    </>
  );

  const ariaCurrent: 'true' | undefined = active ? 'true' : undefined;

  if (!interactive) {
    return (
      <div aria-label={ariaLabel} className={rowClassName}>
        {body}
      </div>
    );
  }

  if (render) {
    return (
      <>
        {render({
          className: rowClassName,
          href,
          onClick: handleClick,
          onKeyDown: handleKeyDown,
          tabIndex,
          'aria-current': ariaCurrent,
          children: body,
        })}
      </>
    );
  }

  if (href !== undefined) {
    return (
      <a
        href={href}
        aria-label={ariaLabel}
        aria-current={ariaCurrent}
        data-active={active ? '' : undefined}
        data-selected={selected ? '' : undefined}
        tabIndex={tabIndex}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={rowClassName}
      >
        {body}
      </a>
    );
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={selected || undefined}
      data-active={active ? '' : undefined}
      data-selected={selected ? '' : undefined}
      tabIndex={tabIndex}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={rowClassName}
    >
      {body}
    </button>
  );
}
