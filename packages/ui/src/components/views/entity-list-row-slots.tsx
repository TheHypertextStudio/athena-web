'use client';

import * as React from 'react';

import { cn } from '../../lib/utils';

/** Props for {@link RowMeta}. */
export interface RowMetaProps {
  children: React.ReactNode;
  /** Use tabular figures (counts, dates, percentages) for stable alignment. */
  tabular?: boolean;
  className?: string;
}

/**
 * A single inline metadata item for an {@link EntityListRow}'s `meta` band.
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

/**
 * How an {@link EntityList} and its rows separate from the page.
 *
 * @remarks
 * - `bordered` (default) — an outlined `bg-surface` container with hairline `border-b` row
 *   dividers. The original chrome; Teams and Cycles keep it.
 * - `tonal` — a borderless `bg-surface-container-low` container whose rows separate purely by the
 *   MD3 surface step on hover (`rounded-lg`, no dividers). Matches the Projects/Initiatives list
 *   treatment, replacing stacked borders with tonal hierarchy.
 */
export type EntityListTone = 'bordered' | 'tonal';

/**
 * The tone an {@link EntityListRow} inherits from its enclosing {@link EntityList}.
 *
 * @remarks
 * Provided by {@link EntityList} so a row need not be told its tone at each call site; a row
 * rendered outside a list falls back to `bordered`.
 */
export const EntityListToneContext = React.createContext<EntityListTone>('bordered');

/** Props for {@link EntityList}. */
export interface EntityListProps {
  children: React.ReactNode;
  'aria-label'?: string;
  className?: string;
  /** How the list and its rows separate from the page. Defaults to `bordered`. */
  tone?: EntityListTone;
}

/**
 * The container that wraps a dense column of {@link EntityListRow}s, in either tone.
 *
 * @remarks
 * `bordered` renders the spec's `rounded-xl border-outline-variant` chrome, with hairline dividers
 * coming from each row's own bottom border. `tonal` renders a `bg-surface-container-low rounded-xl`
 * card with `p-2` padding and no border, letting rows separate by surface step alone. Each row is
 * its own focusable control, so the container is a labelled `group` rather than an ARIA `list`.
 *
 * @example
 * ```tsx
 * <EntityList aria-label="Programs" tone="tonal">
 *   {programs.map((p) => <EntityListRow key={p.id} title={p.name} onActivate={() => open(p.id)} />)}
 * </EntityList>
 * ```
 */
export function EntityList({
  children,
  'aria-label': ariaLabel,
  className,
  tone = 'bordered',
}: EntityListProps): React.JSX.Element {
  return (
    <EntityListToneContext.Provider value={tone}>
      <div
        role="group"
        aria-label={ariaLabel}
        className={cn(
          'flex w-full flex-col rounded-xl',
          tone === 'bordered'
            ? 'border-outline-variant bg-surface overflow-hidden border'
            : 'bg-surface-container-low p-2',
          className,
        )}
      >
        {children}
      </div>
    </EntityListToneContext.Provider>
  );
}
