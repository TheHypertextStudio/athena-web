/**
 * `today/today-section` — the one section shell every Today section renders into.
 *
 * @remarks
 * Today grew five sections and five container recipes: `rounded-2xl border-primary/25 bg-primary/6
 * p-5`, `rounded-xl border-outline-variant bg-surface-container-lowest p-4`, `rounded-2xl
 * border-primary/20 bg-primary/4 p-5`, and two more. Three radii and three paddings on one page,
 * none of them from a token, none of them going through {@link Surface}. This is the single shape.
 *
 * Two hierarchy rules the page was breaking are enforced here rather than restated per section:
 *
 * 1. **A section heading is smaller than the page title.** Both were `text-title-large`, which made
 *    "Projects & initiatives" read heavier than "Today" — section headings are non-semibold at the same
 *    size, so the larger-looking word was the subordinate one. Sections are `title-medium`.
 * 2. **A heading names its contents literally.** The labels this replaces — "The day", "Work in
 *    motion", "Keep the momentum" — were figures of speech where a person needs a noun, and each
 *    carried a sub-line narrating the section to someone already reading it. A `count` carries the
 *    only supporting fact that was ever load-bearing.
 */
import { Row, Stack } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

/** Props for {@link TodaySection}. */
export interface TodaySectionProps {
  /** Stable id for the heading, used as the section's `aria-labelledby`. */
  readonly id: string;
  /** The section's label. A noun phrase — never a sentence. */
  readonly heading: string;
  /**
   * How many things the section holds, rendered beside the heading in tabular figures.
   *
   * @remarks
   * Omit when the count is not a fact worth stating. Zero is meaningful for some sections and
   * noise for others, so the decision stays with the caller rather than being inferred here.
   */
  readonly count?: number | undefined;
  /** An action pinned to the heading row's end (a link out, a filter). */
  readonly action?: ReactNode;
  /** The section's body. */
  readonly children: ReactNode;
}

/** One Today section: a labelled heading row over its content, at one consistent rhythm. */
export function TodaySection({
  id,
  heading,
  count,
  action,
  children,
}: TodaySectionProps): JSX.Element {
  return (
    <Stack as="section" gap={2} aria-labelledby={id}>
      <Row gap={3}>
        <h2 id={id} className="text-on-surface text-title-medium">
          {heading}
        </h2>
        {count === undefined ? null : (
          <span className="text-on-surface-variant text-label-large tabular-nums">
            {String(count)}
          </span>
        )}
        {action ? <Row className="ml-auto">{action}</Row> : null}
      </Row>
      {children}
    </Stack>
  );
}

export default TodaySection;
