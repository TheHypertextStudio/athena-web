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
 * `bg-surface-container-highest` active/selected tone, and the inset `focus-visible` ring —
 * so a virtualized {@link ListView} of tasks and a plain list of entities read as the same
 * component family. Density follows the spec (`min-h-10`, `px-3`, `gap-3`).
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
   * destination yet (e.g. an entity with no detail screen): it keeps the row's density,
   * dividers, and layout but renders an inert element with no pointer cursor, hover tone, or
   * focus ring, so it never offers a click that leads nowhere.
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
  /** The composed row class string (MD3 surfaces, density, focus ring). */
  className: string;
  /** The link target, when the row is a link. */
  href?: string;
  /** Click handler that invokes the row's `onActivate`. */
  onClick: () => void;
  /** Keydown handler that activates on Enter. */
  onKeyDown: (event: React.KeyboardEvent) => void;
  /** Roving tab index. */
  tabIndex: number;
  /** `aria-current` mirror of the active state for link rows. */
  'aria-current': 'true' | undefined;
  /** The row body (leading, title, meta, trailing) to render as children. */
  children: React.ReactNode;
}

/**
 * The shared MD3 row layout — density, dividers, and the named container query.
 *
 * @remarks
 * The chrome common to both interactive and presentational rows: the `@container/row` so the
 * meta band can auto-hide when narrow, the `group/row` so `revealTrailingOnHover` can key off
 * hover, the hairline `border-b` divider (dropped on the last row), and the spec density
 * (`min-h-10`, `px-3`, `gap-3`). Kept as a constant so a single edit retints every preset.
 */
const ROW_BASE =
  '@container/row group/row border-outline-variant relative flex min-h-10 w-full items-center gap-3 border-b px-3 py-1.5 text-left text-sm last:border-b-0';

/**
 * The interactive affordances layered onto {@link ROW_BASE} for a focusable row.
 *
 * @remarks
 * The pointer cursor, the `hover` / `focus-visible` surface tones, and the inset focus ring —
 * identical in spirit to {@link ListRow} so the two stay visually reconciled. Omitted for a
 * presentational (`interactive={false}`) row so it offers no click affordance.
 */
const ROW_INTERACTIVE =
  'cursor-pointer transition-colors outline-none hover:bg-surface-container-high focus-visible:bg-surface-container-high focus-visible:ring-ring focus-visible:ring-1 focus-visible:ring-inset';

/**
 * The canonical, customizable entity list row.
 *
 * @remarks
 * Composes the leading / title / subtitle / meta / trailing slots into one dense, keyboard-
 * operable row. Renders a `<button>` by default, an `<a>` when `href` is set, or a fully
 * custom element via `render` (e.g. a Next.js `Link`); pass `interactive={false}` for an inert
 * presentational `<div>` row (an entity with no detail screen yet). Selection and the active
 * (keyboard-focused) state both adopt the MD3 `bg-surface-container-highest` tone, matching
 * {@link ListRow}.
 *
 * @example
 * ```tsx
 * <EntityListRow
 *   leading={<StatusIcon type="started" />}
 *   title="Billing revamp"
 *   meta={
 *     <>
 *       <RowMeta><ActorAvatar kind="human" name="Ada" size={18} /> Ada</RowMeta>
 *       <RowMeta><RowProgress value={62} /> 62%</RowMeta>
 *     </>
 *   }
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
  const handleClick = React.useCallback(() => {
    onActivate?.();
  }, [onActivate]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') {
        // For a real <a>, Enter already navigates; only synthesize activation for non-links.
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
    interactive && ROW_INTERACTIVE,
    (active || selected) && 'bg-surface-container-highest',
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

  // A presentational row: same layout + dividers, but inert (no destination, no focus ring).
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

/** Props for {@link RowMeta}. */
export interface RowMetaProps {
  /** The metadata content (icon + label, avatar + name, count, …). */
  children: React.ReactNode;
  /** Use tabular figures (counts, dates, percentages) for stable alignment. */
  tabular?: boolean;
  /** Extra classes merged onto the meta item. */
  className?: string;
}

/**
 * A single inline metadata item for an {@link EntityListRow}'s `meta` band.
 *
 * @remarks
 * A flex run with a consistent `gap-1.5` so an icon/avatar and its label sit together; pass
 * `tabular` for numeric meta (counts, dates, percentages) so columns line up across rows.
 *
 * @example
 * ```tsx
 * <RowMeta tabular><ListChecks className="size-3.5" /> 12 tasks</RowMeta>
 * ```
 */
export function RowMeta({ children, tabular = false, className }: RowMetaProps): React.JSX.Element {
  return (
    <span className={cn('flex items-center gap-1.5', tabular && 'tabular-nums', className)}>
      {children}
    </span>
  );
}

/** Props for {@link RowProgress}. */
export interface RowProgressProps {
  /** Completion percentage in `0..100`; clamped into range. */
  value: number;
  /** Accessible label describing what the bar measures. */
  label?: string;
  /** Track width utility (defaults to `w-16`). */
  className?: string;
  /** The fill color utility token; defaults to `bg-state-started`. */
  fillClassName?: string;
}

/**
 * A thin, fixed-width progress bar sized for an {@link EntityListRow}'s meta band.
 *
 * @remarks
 * Renders an accessible `role="progressbar"` track (`bg-surface-container`) with a token-
 * colored fill, clamped to `0..100`. Use inside a {@link RowMeta} next to the numeric value.
 *
 * @example
 * ```tsx
 * <RowMeta tabular><RowProgress value={62} label="Weighted progress" /> 62%</RowMeta>
 * ```
 */
export function RowProgress({
  value,
  label,
  className,
  fillClassName = 'bg-state-started',
}: RowProgressProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className={cn(
        'bg-surface-container relative inline-block h-1.5 w-16 overflow-hidden rounded-full align-middle',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 rounded-full', fillClassName)}
        style={{ width: `${String(clamped)}%` }}
      />
    </span>
  );
}

/** Props for {@link EntityList}. */
export interface EntityListProps {
  /** The rows — typically {@link EntityListRow}s. */
  children: React.ReactNode;
  /** Accessible label for the list. */
  'aria-label'?: string;
  /** Extra classes merged onto the list container. */
  className?: string;
}

/**
 * The clean, bordered container that wraps a dense column of {@link EntityListRow}s.
 *
 * @remarks
 * The spec's `rounded-xl border-outline-variant overflow-hidden` chrome; the hairline dividers
 * come from each row's own bottom border (the last row drops it via `last:border-b-0`), so the
 * container needs no per-row separators. Replaces the former card grid wrappers for entity
 * lists. Each row is its own focusable control, so — like Linear's list — the container is a
 * labelled `group` rather than an ARIA `list` (which would demand `listitem` children and
 * strip the rows' button/link semantics).
 *
 * @example
 * ```tsx
 * <EntityList aria-label="Projects">
 *   {projects.map((p) => (
 *     <EntityListRow key={p.id} title={p.name} onActivate={() => open(p.id)} />
 *   ))}
 * </EntityList>
 * ```
 */
export function EntityList({
  children,
  'aria-label': ariaLabel,
  className,
}: EntityListProps): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'border-outline-variant bg-surface flex w-full flex-col overflow-hidden rounded-xl border',
        className,
      )}
    >
      {children}
    </div>
  );
}
