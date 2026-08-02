import type { JSX, ReactNode } from 'react';

/** Props for {@link PropertyRow}. */
interface PropertyRowProps {
  /** The property's label, shown in the left gutter. */
  label: string;
  /** The property's value content; pass a string, a control, or any node. */
  children: ReactNode;
}

/**
 * One labeled row in the task PROPERTIES panel.
 *
 * @remarks
 * A two-column layout on a single shared grid: a fixed-width (`w-28`) muted label gutter and a
 * flexible value slot. Every row is the *same* fixed height (`h-9`, 36px — the standard
 * interactive-control height), which is what makes a column of them line up: the labels share one
 * left edge, the value containers share one left edge, and no row is taller than its neighbour
 * because of what happens to sit in it.
 *
 * That fixed height is load-bearing, not cosmetic. The old row was `min-h-8 items-start py-1.5`
 * with a `pt-0.5` nudge on the label, so a row holding a 36px picker button measured 49px while a
 * row holding a 20px text span measured 35px — a visible 15px stagger down the panel, and the
 * reason a column of properties read as ragged. Rows are therefore flush (no vertical padding of
 * their own); the *panel* groups them with spacing.
 *
 * The value slot deliberately does not wrap (`flex-wrap` is absent): a wrapping value would grow
 * the row past `h-9` and reintroduce exactly the unevenness this row exists to prevent. Values that
 * cannot fit truncate instead. Type comes from the panel — this row sets no font size of its own,
 * so every label and every value resolves to the one inherited MD3 token.
 */
export function PropertyRow({ label, children }: PropertyRowProps): JSX.Element {
  return (
    <div className="flex h-9 items-center gap-3">
      <span className="text-on-surface-variant w-28 shrink-0">{label}</span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}
