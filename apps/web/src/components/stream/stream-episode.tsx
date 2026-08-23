'use client';

/** `stream` — an inline, subject-led episode in the context timeline. */
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

/** Props for {@link StreamEpisodeView}. */
export interface StreamEpisodeViewProps {
  readonly episode: StreamEpisode;
  readonly scope: 'me' | 'org';
  readonly orgName?: string;
  readonly onSelect?: (row: StreamEventRow) => void;
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
    <p className="text-on-surface-variant text-body-small min-h-10 py-2">
      {subject} made{' '}
      {events.length === 1 ? 'a small update' : `${String(events.length)} small updates`}
    </p>
  );
}

/** Render a subject once, followed by explicit substantive changes and disclosed minor activity. */
export function StreamEpisodeView({
  episode,
  scope,
  orgName,
  onSelect,
}: StreamEpisodeViewProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const first = episode.allEvents[0];
  if (!first) return null;
  const Icon = entityGlyph(first.entityKind);
  const href = streamHref(first);
  const title = first.entityTitle ?? first.title;
  const systems = [...new Set(episode.allEvents.map((event) => event.system))].filter(
    (system) => system !== 'docket',
  );
  const relatedCount = episode.relatedEvents.length;
  const disclosureLabel = `Show ${String(relatedCount)} related ${relatedCount === 1 ? 'event' : 'events'}`;

  return (
    <article className="border-outline-variant/70 grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 border-b py-4 last:border-b-0">
      <div className="bg-surface-container text-on-surface-variant flex size-10 items-center justify-center rounded-full">
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

        <ol aria-label={`Events about ${title}`} className="divide-outline-variant/50 divide-y">
          {episode.visibleEvents.map((event) => (
            <li key={event.id}>
              <StreamEventLine row={event} {...(onSelect ? { onSelect } : {})} />
            </li>
          ))}
        </ol>

        {episode.minorOnly ? <MinorSummary events={episode.relatedEvents} /> : null}

        {relatedCount > 0 ? (
          <div className="mt-1">
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={disclosureLabel}
              onClick={() => {
                setExpanded((value) => !value);
              }}
              className={cn(
                'text-on-surface-variant hover:text-on-surface text-label-medium min-h-10 rounded-md px-2 outline-none',
                focusRing,
              )}
            >
              {expanded
                ? 'Hide related activity'
                : `${String(relatedCount)} related ${relatedCount === 1 ? 'event' : 'events'}`}
            </button>
            {expanded ? (
              <ol
                aria-label="Related activity"
                className="border-outline-variant/60 ml-2 border-l pl-3"
              >
                {episode.relatedEvents.map((event) => (
                  <li key={event.id}>
                    <StreamEventLine row={event} quiet {...(onSelect ? { onSelect } : {})} />
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
