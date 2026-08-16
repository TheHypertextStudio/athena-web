import type { JSX, ReactNode } from 'react';

import { Text } from '@docket/ui/primitives';

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
 *
 * A caption over a run of content, **not** a container: the tonal card is
 * {@link SettingsGroup}, and the two are kept apart so a caption can head several cards without
 * wrapping them in a box that implies they are one thing.
 *
 * The heading is `label-medium` — the role whose 12/16/500 this had been spelling out by hand as a
 * size plus a weight. It is a name for a run of controls rather than prose about them, which is
 * what puts it in the `label-*` family instead of `title-*`.
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
          <Text as="h2" token="label-medium" tone="muted">
            {title}
          </Text>
          {action}
        </div>
      ) : (
        <Text as="h2" token="label-medium" tone="muted">
          {title}
        </Text>
      )}
      {children}
    </section>
  );
}
