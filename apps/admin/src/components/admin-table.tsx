'use client';

import { EntityList, EntityListRow, EntityTable } from '@docket/ui/components';
import type { Column } from '@docket/ui/components';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

/**
 * Drop every key whose value is `undefined`, keeping the rest under their original (now
 * `undefined`-free) types.
 *
 * @remarks
 * `EntityTable` hands its row-link slot optional handlers typed as `T | undefined`, which
 * `next/link`'s own prop types reject under `exactOptionalPropertyTypes`. Stripping the absent keys
 * lets the rest be spread wholesale — and spreading matters: cherry-picking `href` would silently
 * drop the grid's `role`, `aria-rowindex`, `aria-current`, `tabIndex`, and prefetch handlers with
 * no type error, turning a keyboard-navigable grid row back into a plain anchor.
 */
function withoutUndefinedValues<T extends object>(
  value: T,
): {
  [K in keyof T]: Exclude<T[K], undefined>;
} {
  const result = {} as { [K in keyof T]: Exclude<T[K], undefined> };
  for (const key of Object.keys(value) as (keyof T)[]) {
    const fieldValue = value[key];
    if (fieldValue !== undefined) {
      result[key] = fieldValue as Exclude<T[typeof key], undefined>;
    }
  }
  return result;
}

/** Props for {@link AdminTable}. */
export interface AdminTableProps<T> {
  /** Accessible name for the grid. */
  readonly label: string;
  /** The column specification, in display order. */
  readonly columns: readonly Column<T>[];
  /** The rows to render. */
  readonly rows: readonly T[];
  /** Stable React key for a row. */
  readonly getRowKey: (row: T) => string;
  /** Where a row navigates to. */
  readonly rowHref: (row: T) => string;
}

/**
 * The console's one list surface: a column-aligned, navigable table.
 *
 * @remarks
 * Wraps the shared {@link EntityTable} with the routing plumbing every operator list needs, so no
 * screen repeats it and no screen can get it subtly wrong. Every list in the console renders
 * through this, which is what makes a user row, an org row, and an audit row read as the same
 * component family.
 *
 * @typeParam T - The row type.
 * @param props - See {@link AdminTableProps}.
 * @returns the navigable table.
 */
export function AdminTable<T>({
  label,
  columns,
  rows,
  getRowKey,
  rowHref,
}: AdminTableProps<T>): JSX.Element {
  return (
    <EntityTable
      aria-label={label}
      columns={columns}
      rows={rows}
      getRowKey={getRowKey}
      rowHref={rowHref}
      renderRowLink={({ children, ...linkProps }) => (
        <Link {...withoutUndefinedValues(linkProps)}>{children}</Link>
      )}
    />
  );
}

/** Props for {@link AdminList}. */
export interface AdminListProps {
  /** Accessible name for the group of rows. */
  readonly label: string;
  /** The rows, each an {@link AdminListRow}. */
  readonly children: ReactNode;
}

/**
 * A dense column of navigable rows, separated by surface tone rather than by drawn lines.
 *
 * @remarks
 * Uses the shared `EntityList` in its `tonal` tone: rows sit on a `surface-container-low` card with
 * no border, and each row separates from its neighbours by rounding and hover tone alone. That is
 * the treatment the design system asks for — a tonal step on the surface ramp, never a hairline —
 * and it is what the console's hand-rolled bordered rows were standing in for.
 *
 * @param props - See {@link AdminListProps}.
 * @returns the row group.
 */
export function AdminList({ label, children }: AdminListProps): JSX.Element {
  return (
    <EntityList aria-label={label} tone="tonal">
      {children}
    </EntityList>
  );
}

/** Props for {@link AdminListRow}. */
export interface AdminListRowProps {
  /** The leading identity slot: a glyph, avatar, or status mark. */
  readonly leading?: ReactNode;
  /** The row's primary line. */
  readonly title: ReactNode;
  /** An optional muted second line. */
  readonly subtitle?: ReactNode;
  /** Inline metadata after the title. */
  readonly meta?: ReactNode;
  /** The trailing slot, pinned to the row's end. */
  readonly trailing?: ReactNode;
  /** Where the row navigates to. */
  readonly href: string;
}

/**
 * One navigable row inside an {@link AdminList}.
 *
 * @remarks
 * Renders through `next/link` so the row is a real anchor — right-clickable, openable in a new tab,
 * and prefetched by the router — while keeping the shared row's density, hover tone, and inset
 * focus ring.
 *
 * @param props - See {@link AdminListRowProps}.
 * @returns the row.
 */
export function AdminListRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  href,
}: AdminListRowProps): JSX.Element {
  return (
    <EntityListRow
      href={href}
      title={title}
      {...(leading ? { leading } : {})}
      {...(subtitle ? { subtitle } : {})}
      {...(meta ? { meta } : {})}
      {...(trailing ? { trailing } : {})}
      render={({ children, href: rowHref, ...rowProps }) => (
        // The row's render slot types `href` as optional, because a row without a destination is a
        // button. This row always has one, so the outer `href` stands in and Link gets a definite
        // string rather than a possibly-absent one.
        <Link href={rowHref ?? href} {...withoutUndefinedValues(rowProps)}>
          {children}
        </Link>
      )}
    />
  );
}
