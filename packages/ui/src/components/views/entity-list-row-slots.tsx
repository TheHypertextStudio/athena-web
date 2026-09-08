'use client';

import * as React from 'react';

import { cn } from '../../lib/utils';
import { surfaceToneColor } from '../../primitives/surface';

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
 * <RowMeta tabular><ListChecks className="size-4" /> 12 tasks</RowMeta>
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
        surfaceToneColor('canvas'),
        'relative inline-block h-1.5 w-16 overflow-hidden rounded-full align-middle',
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
 * One tone. `tonal` is a borderless `bg-surface-container-low` container whose rows separate by the
 * MD3 surface step on hover (`rounded-lg`, no dividers).
 *
 * There was a `bordered` tone — an outlined `bg-surface` container with hairline `border-b` row
 * dividers — and it was the *default*, yet every one of the five call sites passed `tonal`
 * explicitly. Nobody chose it, and §8 puts separation outside the three things that earn a border,
 * so it is gone rather than kept as an unused second vocabulary. The prop survives because those
 * five call sites name the tone they want and there is no reason to churn them.
 */
export type EntityListTone = 'tonal';

/**
 * The tone an {@link EntityListRow} inherits from its enclosing {@link EntityList}.
 *
 * @remarks
 * Provided by {@link EntityList} so a row need not be told its tone at each call site; a row
 * rendered outside a list falls back to `tonal`, which is now the only tone.
 */
export const EntityListToneContext = React.createContext<EntityListTone>('tonal');

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
  tone = 'tonal',
}: EntityListProps): React.JSX.Element {
  return (
    <EntityListToneContext.Provider value={tone}>
      <div
        role="group"
        aria-label={ariaLabel}
        className={cn(
          'flex w-full flex-col rounded-xl',
          surfaceToneColor('card'),
          'p-2',
          className,
        )}
      >
        {children}
      </div>
    </EntityListToneContext.Provider>
  );
}
