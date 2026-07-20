import type { JSX, ReactNode } from 'react';

/** Props for {@link SettingsSubsection}. */
export interface SettingsSubsectionProps {
  /** The subsection's short label, rendered as its heading and its `aria-label`. */
  title: string;
  /** An optional control aligned to the right of the heading (e.g. an "Add account" button). */
  action?: ReactNode;
  /** The subsection body (rows, cards, or a single control). */
  children: ReactNode;
}

/**
 * A labelled settings subsection: a small caption heading (with an optional trailing action) above
 * its content.
 *
 * @remarks
 * Pure layout — it owns only the heading/spacing rhythm shared by every group on the Connections
 * surface (Communication, Project management, Calendar, Google Tasks, …). It knows nothing about
 * integrations, so any settings surface can compose the same vertical rhythm without duplicating
 * the markup.
 */
export function SettingsSubsection({
  title,
  action,
  children,
}: SettingsSubsectionProps): JSX.Element {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      {action ? (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-on-surface-variant text-xs font-medium">{title}</h2>
          {action}
        </div>
      ) : (
        <h2 className="text-on-surface-variant text-xs font-medium">{title}</h2>
      )}
      {children}
    </section>
  );
}
