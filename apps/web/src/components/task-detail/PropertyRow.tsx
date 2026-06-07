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
 * A two-column layout: a fixed-width muted label gutter on the left and the value on the
 * right, so a stacked list of properties (project, program, milestone, cycle, labels,
 * links) aligns into a clean column. The value side is a flex container so callers can
 * compose avatars, badges, or links inline. Layout/colors are token-backed only.
 */
export function PropertyRow({ label, children }: PropertyRowProps): JSX.Element {
  return (
    <div className="flex min-h-8 items-start gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground w-28 shrink-0 pt-0.5">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}
