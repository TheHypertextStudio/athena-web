/**
 * `publishing` — the published brief, rendered as a document rather than a screen.
 *
 * @remarks
 * A Server Component with no client bundle at all. That is not an optimisation, it is the
 * design: a brief is a page someone reads, links to, prints, and hands to a person who has
 * never heard of Docket. It has no state, nothing to hydrate, and no interactive affordance
 * beyond the browser's own — so it ships as HTML and CSS, loads instantly on a phone on a train,
 * and prints correctly whether or not scripting ran.
 *
 * Three deliberate departures from the app's own surfaces:
 *
 * 1. **No app chrome.** No sidebar, no tab bar, no toolbar. The `(public)` layout contributes a
 *    background and a stylesheet, nothing else.
 * 2. **A measure, not a viewport.** The column is capped at `36rem`, which at the 16px body size
 *    is roughly 70 characters a line — inside the 45–90 band that keeps prose readable, and the
 *    reason the page does not sprawl on a 1440px screen.
 * 3. **Its own palette.** The app's tinted surface containers and accent colour say
 *    "interface". A document says ink and paper, so `brief.css` defines four local variables and
 *    the brief uses those. Type still comes from the shared MD3 scale, so the voice is the same
 *    product's even though the skin is not.
 *
 * @see `app/(public)/brief.css` for the screen/print split.
 */
import type { BriefSection, BriefWorkItem, PublicBriefOut } from '@docket/types';
import { Text } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { formatCalendarDate } from '@/lib/format-date';

import {
  briefFactLabel,
  briefFactValue,
  briefKindLabel,
  briefSectionHeading,
  briefStatusLabel,
} from './brief-vocabulary';

/** Props for {@link BriefDocument}. */
export interface BriefDocumentProps {
  /** The brief, projected live from the publishing workspace's work records. */
  readonly brief: PublicBriefOut;
}

/** Short day form used throughout a brief, e.g. `Sep 30, 2026`. */
function day(iso: string): string | null {
  return formatCalendarDate(iso);
}

/**
 * The published brief document.
 *
 * @param props - The {@link BriefDocumentProps}.
 * @returns The rendered document.
 */
export function BriefDocument({ brief }: BriefDocumentProps): JSX.Element {
  const facts = brief.facts
    .map((fact) => ({
      key: fact.key,
      label: briefFactLabel(brief.subjectKind, fact.key),
      value: briefFactValue(brief.subjectKind, fact, day),
    }))
    // A masthead is a summary, not a form: an unset field is omitted rather than printed as a
    // row of em-dashes that tells the reader nothing.
    .filter((fact): fact is { key: string; label: string; value: string } => fact.value !== null);

  const sections = brief.sections.filter((section) => section.items.length > 0);
  const updated = day(brief.updatedAt);

  return (
    <article className="brief-column mx-auto flex w-full max-w-[36rem] flex-col gap-10 px-5 py-12 sm:px-8 sm:py-16">
      <header className="flex flex-col gap-5">
        {/* Sentence case, not an uppercase overline: the repo's visual contract forbids
            uppercasing semantic labels, and a document masthead reads better without shouting. */}
        <Text as="p" token="label-medium" className="brief-muted">
          {brief.workspaceName} · {briefKindLabel(brief.vocabulary, brief.subjectKind)}
        </Text>
        <Text as="h1" token="headline-large">
          {brief.title}
        </Text>
        {brief.summary ? (
          <Text as="p" token="body-large" className="brief-muted">
            {brief.summary}
          </Text>
        ) : null}

        {facts.length > 0 ? (
          <dl className="brief-rule flex flex-col gap-0 border-t pt-4">
            {facts.map((fact) => (
              <div
                key={fact.key}
                className="brief-fact flex items-baseline justify-between gap-6 py-1.5"
              >
                <Text as="dt" token="label-medium" className="brief-muted">
                  {fact.label}
                </Text>
                <Text as="dd" token="body-medium" className="text-right">
                  {fact.value}
                </Text>
              </div>
            ))}
          </dl>
        ) : null}
      </header>

      {brief.description ? (
        <div className="flex flex-col gap-4">
          {brief.description
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.trim())
            .filter((paragraph) => paragraph.length > 0)
            .map((paragraph) => (
              <Text as="p" token="body-large" key={paragraph.slice(0, 64)}>
                {paragraph}
              </Text>
            ))}
        </div>
      ) : null}

      {sections.map((section) => (
        <BriefSectionBlock key={section.key} brief={brief} section={section} />
      ))}

      <footer className="brief-rule flex flex-col gap-1 border-t pt-4">
        <Text as="p" token="body-small" className="brief-muted">
          Published from {brief.workspaceName}
          {updated ? ` · Reflects the record as of ${updated}` : ''}
        </Text>
        {brief.canonicalUrl ? (
          <Text as="p" token="body-small" className="brief-muted">
            <a className="brief-link" href={brief.canonicalUrl}>
              {brief.canonicalUrl}
            </a>
          </Text>
        ) : null}
      </footer>
    </article>
  );
}

/** One titled group of work under the brief. */
function BriefSectionBlock({
  brief,
  section,
}: {
  readonly brief: PublicBriefOut;
  readonly section: BriefSection;
}): JSX.Element {
  const hidden = section.total - section.items.length;
  return (
    <section className="flex flex-col gap-3">
      <div className="brief-rule flex items-baseline justify-between gap-4 border-b pb-2">
        <Text as="h2" token="title-medium">
          {briefSectionHeading(brief.vocabulary, section.key)}
        </Text>
        <Text as="span" token="label-medium" className="brief-muted" numeric>
          {section.total}
        </Text>
      </div>
      <ul className="flex flex-col">
        {section.items.map((item) => (
          <BriefRow key={item.id} item={item} />
        ))}
      </ul>
      {hidden > 0 ? (
        <Text as="p" token="body-small" className="brief-muted">
          {/* Said out loud rather than silently truncated: a document that quietly drops rows is
              worse than one that admits its own limit. */}
          Showing the first {section.items.length} of {section.total}.
        </Text>
      ) : null}
    </section>
  );
}

/** One line of work: what it is, where it stands, and when it is due. */
function BriefRow({ item }: { readonly item: BriefWorkItem }): JSX.Element {
  const due = item.targetDate === null ? null : day(item.targetDate);
  const status =
    item.status === null
      ? null
      : briefStatusLabel(item.kind === 'milestone' ? 'task' : item.kind, item.status);
  return (
    <li
      className={`brief-row brief-rule flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0 ${
        item.complete ? 'brief-done' : ''
      }`}
    >
      <Text as="span" token="body-medium" className="brief-done-title min-w-0 flex-1">
        {item.title}
      </Text>
      <span className="flex shrink-0 items-baseline gap-3">
        {status ? (
          <Text as="span" token="body-small" className="brief-muted">
            {status}
          </Text>
        ) : null}
        {due ? (
          <Text as="span" token="body-small" className="brief-muted" numeric>
            {due}
          </Text>
        ) : null}
      </span>
    </li>
  );
}
