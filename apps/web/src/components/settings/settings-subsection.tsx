import type { JSX, ReactNode } from 'react';

import { Text } from '@docket/ui/primitives';
import type { SettingsNodeDefinition } from './settings-capabilities';

/** Props for {@link SettingsSubsection}. */
export interface SettingsSubsectionProps {
  /** The subsection's short label, rendered as its heading and its `aria-label`. */
  title?: string;
  /** Stable searchable definition for a static Settings heading. */
  capability?: SettingsNodeDefinition;
  /** Marks a data-derived heading that must not enter the application capability catalog. */
  discoverable?: false;
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
  capability,
  action,
  children,
}: SettingsSubsectionProps): JSX.Element {
  const resolvedTitle = capability?.label ?? title;
  if (!resolvedTitle) throw new Error('SettingsSubsection requires a title or capability.');
  const heading = (
    <Text
      as="h3"
      token="label-medium"
      tone="muted"
      id={capability ? `settings-${capability.id}` : undefined}
      tabIndex={capability ? -1 : undefined}
    >
      {resolvedTitle}
    </Text>
  );
  return (
    <section aria-label={resolvedTitle} className="flex flex-col gap-3">
      {action ? (
        <div className="flex items-center justify-between gap-2">
          {heading}
          {action}
        </div>
      ) : (
        heading
      )}
      {children}
    </section>
  );
}
