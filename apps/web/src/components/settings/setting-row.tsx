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
  /** Navigates. Renders the row as a link. Mutually exclusive with `onActivate`. */
  readonly href?: string;
  /**
   * The element the row renders as.
   *
   * @remarks
   * A row inside a semantic list has to be an `li`, and without this seven of them re-typed
   * `ROW_BASE` as a literal to get one — reintroducing the three hover tones and three heights
   * this component exists to collapse. The row's box is the same either way; only its element
   * changes.
   */
  readonly as?: 'div' | 'li';
  /** Extra classes merged onto the row (layout only — never colour, radius, or padding). */
  readonly className?: string;
}

/**
 * The shared box: dense, aligned to the group header's inset, and flush to the group's edges.
 *
 * @remarks
 * Exported for the rows this component cannot render for them — one whose internals are a chip
 * and three trailing values rather than a label and a description. Six of those had re-typed this
 * string, and between them they had drifted to three hover tones and three heights for a row that
 * is meant to be one object. Composing from here is what keeps a bespoke row's *box* shared even
 * when its contents are not.
 */
export const ROW_BASE = 'flex min-h-12 w-full min-w-0 items-center gap-3 px-4 py-3 text-left';

/** The hover and disabled treatment for a row that responds to a pointer. See {@link ROW_BASE}. */
export const ROW_INTERACTIVE = cn(
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
  href,
  as: Element = 'div',
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
    const link = (
      <NextLink href={href} className={cn(ROW_BASE, ROW_INTERACTIVE, className)}>
        {line}
      </NextLink>
    );
    return Element === 'li' ? <li>{link}</li> : link;
  }

  return <Element className={cn(ROW_BASE, className)}>{line}</Element>;
}
