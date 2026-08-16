/**
 * `settings` — the per-section page header.
 *
 * @remarks
 * Each routed Settings section renders the same compact header (title + one-line description)
 * above its body, so the section pages read consistently and the description copy lives in one
 * place (the {@link SETTINGS_SECTIONS} registry, passed in here). This keeps the section pages
 * themselves focused on their content.
 *
 * The title is `title-medium`, the first of Settings' three heading levels (page section →
 * `title-medium`, group → `title-small`, row label → `label-large`). It previously spelled itself
 * out as a size plus a weight, at 16px/600 — a pairing the fifteen-role scale does not contain, so
 * every page inherited a heading that could not be named.
 *
 * There is no rule beneath it. A border that only separates a header from the content it heads is
 * the grouping border `docs/design/design-system.md` §8 rules out: the gap below and the tonal step
 * of the groups underneath already do that work, and the line was the loudest mark on the surface.
 */
import type { JSX, ReactNode } from 'react';

import { Text } from '@docket/ui/primitives';

/** Props for {@link SectionHeader}. */
export interface SectionHeaderProps {
  /** The section title (e.g. "Members & Access"). */
  title: string;
  /** A short, plain-language summary of the section. */
  description: string;
  /** Optional trailing content aligned to the header's end (e.g. an action). */
  action?: ReactNode;
}

/**
 * A consistent header for a Settings section page.
 *
 * @param props - The {@link SectionHeaderProps}.
 * @returns the rendered section header.
 */
export function SectionHeader({ title, description, action }: SectionHeaderProps): JSX.Element {
  return (
    <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
      <div className="flex flex-col gap-1">
        <Text as="h2" token="title-medium">
          {title}
        </Text>
        <Text as="p" token="body-medium" tone="muted">
          {description}
        </Text>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}
