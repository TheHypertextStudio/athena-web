'use client';

/**
 * `stream` — an inline, subject-led episode in the context timeline.
 *
 * @remarks
 * One subject, stated once, followed by its substantive events as explicit lines and its minor
 * activity behind a single disclosure.
 *
 * ## Two disclosures that cannot be confused
 *
 * The episode owns "N related events", and every line owns its own detail panel. They are told
 * apart by what they produce rather than by how deeply they indent: the episode's toggle adds
 * more *stations to the spine* (the timeline extends downward), while a line's toggle opens a
 * raised card *off* the spine. The affordances differ to match — a labelled text button sitting
 * on the rail versus a full-width row with a trailing chevron.
 *
 * ## Why only one line is open at a time
 *
 * An episode is one subject, so reading two of its events side by side is not a thing anyone
 * needs; and an episode whose height is bounded keeps the infinite-scroll sentinel below it from
 * being shoved around while the user reads. The related-activity disclosure is separate state and
 * is never closed on the user's behalf.
 */
import { cn } from '@docket/ui';
import { focusRing } from '@docket/ui/primitives';
import { useState, type JSX } from 'react';

import { entityGlyph, entityTypeLabel } from '@/components/activity/entity-glyph';
import Link from '@/components/docket-link';
import { OrgChip } from '@/components/org-chip';

import { ProviderBadge } from './provider-badge';
import { StreamEventLine } from './stream-event-line';
import type { StreamEpisode } from './stream-grouping';
import { streamActorLabel, streamHref, type StreamEventRow } from './stream-meta';
import { SpineCell } from './stream-spine';

/** Props for {@link StreamEpisodeView}. */
export interface StreamEpisodeViewProps {
  /** The episode. */
  readonly episode: StreamEpisode;
  /** `me` = cross-org personal feed; `org` = a single workspace's firehose. */
  readonly scope: 'me' | 'org';
  /** The workspace name, shown as a chip in the cross-org feed. */
  readonly orgName?: string;
}

/** One generated line that keeps an all-minor episode visible. */
function MinorSummary({
  events,
}: {
  readonly events: readonly StreamEventRow[];
}): JSX.Element | null {
  const first = events[0];
  if (!first) return null;
  const actor = streamActorLabel(first);
  const sameActor = events.every((event) => streamActorLabel(event) === actor);
  const subject = sameActor ? actor : 'People';
  return (
    <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2">
      <SpineCell mark="related" />
      <p className="text-on-surface-variant text-body-small min-h-10 py-2">
        {subject} made{' '}
        {events.length === 1 ? 'a small update' : `${String(events.length)} small updates`}
      </p>
    </div>
  );
}

/** Render a subject once, followed by explicit substantive changes and disclosed minor activity. */
export function StreamEpisodeView({
  episode,
  scope,
  orgName,
}: StreamEpisodeViewProps): JSX.Element | null {
  const [relatedExpanded, setRelatedExpanded] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const first = episode.allEvents[0];
  if (!first) return null;
  const Icon = entityGlyph(first.entityKind);
  const href = streamHref(first);
  const title = first.entityTitle ?? first.title;
  const systems = [...new Set(episode.allEvents.map((event) => event.system))].filter(
    (system) => system !== 'docket',
  );
  const relatedCount = episode.relatedEvents.length;
  const relatedListId = `stream-related-${episode.key}`;
  const disclosureLabel = `Show ${String(relatedCount)} related ${relatedCount === 1 ? 'event' : 'events'}`;

  function toggleEvent(id: string): void {
    setExpandedEventId((current) => (current === id ? null : id));
  }

  // The rail stops at the episode's final station. Which row that is depends on what is
  // disclosed, so it is derived here rather than guessed by a `:last-child` selector.
  const lastVisibleIndex = episode.visibleEvents.length - 1;
  const railEndsInVisible = relatedCount === 0 && !episode.minorOnly;

  return (
    <article className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 py-4">
      <div className="bg-surface-container-high text-on-surface-variant ring-outline-variant flex size-10 items-center justify-center rounded-full ring-1">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <header className="mb-1.5 min-w-0">
          {href ? (
            <Link
              href={href}
              className={cn(
                'text-on-surface hover:text-primary text-title-small block w-fit max-w-full rounded-sm outline-none',
                focusRing,
              )}
            >
              <span className="block truncate">{title}</span>
            </Link>
          ) : (
            <h3 className="text-on-surface text-title-small truncate">{title}</h3>
          )}
          <div className="text-on-surface-variant text-label-small mt-1 flex flex-wrap items-center gap-2 capitalize">
            <span>{entityTypeLabel(first.entityKind)}</span>
            {systems.map((system) => (
              <ProviderBadge key={system} system={system} />
            ))}
            {scope === 'me' ? (
              <OrgChip orgId={first.organizationId} name={orgName ?? 'Workspace'} />
            ) : null}
          </div>
        </header>

        <ol aria-label={`Events about ${title}`}>
          {episode.visibleEvents.map((event, index) => (
            <li key={event.id}>
              <StreamEventLine
                row={event}
                expanded={expandedEventId === event.id}
                onToggle={toggleEvent}
                terminal={railEndsInVisible && index === lastVisibleIndex}
              />
            </li>
          ))}
        </ol>

        {episode.minorOnly ? <MinorSummary events={episode.relatedEvents} /> : null}

        {relatedCount > 0 ? (
          <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2">
            <SpineCell mark="toggle" open={relatedExpanded} terminal={!relatedExpanded} />
            <div className="min-w-0">
              <button
                type="button"
                aria-expanded={relatedExpanded}
                aria-controls={relatedListId}
                aria-label={disclosureLabel}
                onClick={() => {
                  setRelatedExpanded((value) => !value);
                }}
                className={cn(
                  'text-on-surface-variant hover:text-on-surface text-label-medium min-h-10 rounded-md px-1 outline-none',
                  focusRing,
                )}
              >
                {relatedExpanded
                  ? 'Hide related activity'
                  : `${String(relatedCount)} related ${relatedCount === 1 ? 'event' : 'events'}`}
              </button>
            </div>
            {relatedExpanded ? (
              <ol id={relatedListId} aria-label="Related activity" className="col-span-2 -mt-1">
                {episode.relatedEvents.map((event, index) => (
                  <li key={event.id}>
                    <StreamEventLine
                      row={event}
                      quiet
                      expanded={expandedEventId === event.id}
                      onToggle={toggleEvent}
                      terminal={index === episode.relatedEvents.length - 1}
                    />
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
