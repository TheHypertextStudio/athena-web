/**
 * `settings` — the dense settings row.
 *
 * @remarks
 * Settings is a product of lists — passkeys, sessions, members, invitations, connected apps,
 * calendar accounts, MCP connectors — and each of those lists had grown its own row: four hover
 * fills, four divider treatments, six row heights, and thirteen ways of setting a row's label.
 * This is that row, once.
 *
 * ## Why this is not `ListRow`
 *
 * `packages/ui/src/components/views/ListRow.tsx` looks like the obvious thing to reuse and is the
 * wrong primitive here. It is an entity **grid** row: it emits `role="row"` with `role="gridcell"`
 * children, and carries selection, roving `tabIndex`, and drag sources for the virtualized
 * {@link ListView}. A settings list is a set of labelled controls, not a grid of records — giving
 * it grid semantics would tell a screen reader to navigate a form by cell coordinates, and would
 * hand every row selection and drag affordances that lead nowhere.
 *
 * So this borrows `ListRow`'s *visual* grammar — a leading slot, a title that flexes and
 * truncates, a trailing slot, one tonal hover, no dividers — and keeps ordinary semantics. A
 * static row is a `div`, an activating row is a `button`, a navigating row is a link. The element
 * follows what the row actually does.
 *
 * ## No dividers
 *
 * Rows separate by rhythm and by their hover step, not by a rule between them.
 * `docs/design/design-system.md` §8 justifies a border only as a field's affordance, a focus
 * indicator, or a genuine semantic boundary — and lists "grouping and separation" as explicitly
 * not on that list. The four `divide-y`/`border-b` dialects this replaces were all doing the
 * excluded thing.
 */
import { Text, focusRingInset } from '@docket/ui/primitives';
import { cn } from '@docket/ui';
import NextLink from 'next/link';
import type { JSX, ReactNode } from 'react';

/** Props for {@link SettingRow}. */
export interface SettingRowProps {
  /** A leading glyph, avatar, or status mark. */
  readonly leading?: ReactNode;
  /** The row's name — what this row *is*. Rendered `label-large`. */
  readonly label: ReactNode;
  /** A quieter second line beneath the label. */
  readonly description?: ReactNode;
  /** Controls aligned to the row's trailing edge (a switch, a button, an overflow menu). */
  readonly trailing?: ReactNode;
  /** Content stacked beneath the row's own line — an expanded panel, an error, a nested form. */
  readonly children?: ReactNode;
  /** Activates the row. Renders the row as a `button`. Mutually exclusive with `href`. */
  readonly onActivate?: () => void;
  /** Navigates. Renders the row as a link. Mutually exclusive with `onActivate`. */
  readonly href?: string;
  /** Accessible name for an interactive row whose `label` is not descriptive on its own. */
  readonly activateLabel?: string;
  /** Extra classes merged onto the row (layout only — never colour, radius, or padding). */
  readonly className?: string;
}

/** The shared box: dense, aligned to the group header's inset, and flush to the group's edges. */
const ROW_BASE = 'flex min-h-12 w-full min-w-0 items-center gap-3 px-4 py-3 text-left';

/** The one hover answer — a single step above the `card` tone the group paints. */
const ROW_INTERACTIVE = cn(
  'hover:bg-surface-container transition-colors',
  focusRingInset,
  'disabled:pointer-events-none disabled:opacity-38',
);

/**
 * A dense, aligned settings row.
 *
 * @param props - The {@link SettingRowProps}.
 * @returns the rendered row.
 */
export function SettingRow({
  leading,
  label,
  description,
  trailing,
  children,
  onActivate,
  href,
  activateLabel,
  className,
}: SettingRowProps): JSX.Element {
  const line = (
    <>
      {leading ? (
        <span className="text-on-surface-variant flex shrink-0 items-center">{leading}</span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* A string label is the row's name and takes the row's type role. Anything else already
            carries its own — a chip, an avatar-and-name pair — and wrapping it in a truncating
            text span would clip a box that knows its own width. */}
        {typeof label === 'string' ? (
          <Text token="label-large" truncate>
            {label}
          </Text>
        ) : (
          label
        )}
        {description ? (
          <Text token="body-small" tone="muted">
            {description}
          </Text>
        ) : null}
      </span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-2" data-slot="setting-row-trailing">
          {trailing}
        </span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <NextLink
        href={href}
        className={cn(ROW_BASE, ROW_INTERACTIVE, className)}
        {...(activateLabel ? { 'aria-label': activateLabel } : {})}
      >
        {line}
      </NextLink>
    );
  }

  if (onActivate) {
    return (
      <button
        type="button"
        onClick={onActivate}
        className={cn(ROW_BASE, ROW_INTERACTIVE, className)}
        {...(activateLabel ? { 'aria-label': activateLabel } : {})}
      >
        {line}
      </button>
    );
  }

  // A row with nested content is a region, not a line: the label line keeps the row box and the
  // children stack beneath it at the same inset.
  if (children) {
    return (
      <div className={cn('flex min-w-0 flex-col', className)}>
        <div className={ROW_BASE}>{line}</div>
        <div className="flex min-w-0 flex-col gap-3 px-4 pb-3">{children}</div>
      </div>
    );
  }

  return <div className={cn(ROW_BASE, className)}>{line}</div>;
}
