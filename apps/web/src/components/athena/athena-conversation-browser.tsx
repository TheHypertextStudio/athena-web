'use client';

/**
 * Browsing the one endless Athena conversation: topics, keyword search, date range.
 *
 * @remarks
 * There is one conversation and it never ends, so the composer alone cannot be the whole
 * surface — without a way back into it, everything said more than a screen ago is gone. This
 * panel is that way back, and it has three controls because there are three ways a person
 * actually remembers a conversation: by what it was about, by a word that was in it, and by
 * when it happened. They compose; none of them is a mode.
 *
 * There is deliberately no "new topic" control. Topics are derived from the conversation by the
 * API and simply appear; asking a person to declare a topic boundary is the chore this replaces.
 */
import { Calendar, MessagesSquare, Search } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, ControlGroup, Field, Input, Text, Toolbar } from '@docket/ui/primitives';
import { type JSX, useMemo, useState } from 'react';

import { DatePicker } from '@/components/date-picker';
import { api } from '@/lib/api';
import { apiQueryOptions, STALE } from '@/lib/query-core';
import { useApiListQuery, useApiQuery } from '@/lib/query';
import { useDebouncedValue } from '@/lib/use-debounced-value';

/** Which lens the browser is showing. */
type BrowseLens = 'topics' | 'search';

/** Query definition for the conversation's derived topics. */
function segmentsDef() {
  return apiQueryOptions(
    ['me', 'athena', 'chat', 'segments'] as const,
    () => api.v1.me.athena.chat.segments.$get(),
    'Could not load the conversation’s topics.',
    { staleTime: STALE.volatile },
  );
}

/** Query definition for one conversation search. */
function searchDef(query: { readonly q?: string; readonly from?: string; readonly to?: string }) {
  return apiQueryOptions(
    ['me', 'athena', 'chat', 'search', query.q ?? '', query.from ?? '', query.to ?? ''] as const,
    () =>
      api.v1.me.athena.chat.search.$get({
        query: {
          ...(query.q ? { q: query.q } : {}),
          ...(query.from ? { from: query.from } : {}),
          ...(query.to ? { to: query.to } : {}),
        },
      }),
    'Could not search the conversation.',
    { staleTime: STALE.volatile },
  );
}

/** Turn a `yyyy-mm-dd` day into the instant that day begins or ends, in the reader's own zone. */
function dayBoundary(day: string, edge: 'start' | 'end'): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const at = new Date(`${day}T${edge === 'start' ? '00:00:00' : '23:59:59.999'}`);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** Render text with the searched term marked, using the ranges the API reported. */
function Highlighted({
  text,
  spans,
}: {
  readonly text: string;
  readonly spans: readonly { readonly start: number; readonly end: number }[];
}): JSX.Element {
  if (spans.length === 0) return <>{text}</>;
  const pieces: JSX.Element[] = [];
  let cursor = 0;
  spans.forEach((span, index) => {
    if (span.start > cursor) {
      pieces.push(<span key={`plain-${String(index)}`}>{text.slice(cursor, span.start)}</span>);
    }
    pieces.push(
      <mark
        key={`hit-${String(index)}`}
        className="bg-secondary-container text-on-secondary-container rounded-sm"
      >
        {text.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  });
  if (cursor < text.length) pieces.push(<span key="plain-tail">{text.slice(cursor)}</span>);
  return <>{pieces}</>;
}

/** Props for {@link AthenaConversationBrowser}. */
export interface AthenaConversationBrowserProps {
  /** Called with the activity id to scroll to when a topic or result is chosen. */
  readonly onJump?: (activityId: string) => void;
  /** Extra class names for the root element; the host owns width and height. */
  readonly className?: string;
}

/** Longer than the palette's: this search scans the whole conversation history in process. */
const SEARCH_DEBOUNCE_MS = 280;

/** Below two characters the scan matches nearly everything, at full cost. */
const MIN_SEARCH_CHARS = 2;

/** The topics / search / date-range panel for the one Athena conversation. */
export function AthenaConversationBrowser({
  onJump,
  className,
}: AthenaConversationBrowserProps): JSX.Element {
  const [lens, setLens] = useState<BrowseLens>('topics');
  const [term, setTerm] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');

  // Only the typed term is debounced. The dates come from `DatePicker` clicks, not keystrokes —
  // delaying those would feel broken — and this search is expensive enough to be worth waiting
  // for: it scans every activity row across all of the caller's sessions and scores them in
  // process. It previously ran on every character, with no minimum length at all.
  const typed = term.trim();
  const settledTerm = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);
  const usableTerm = settledTerm.length >= MIN_SEARCH_CHARS ? settledTerm : '';

  const searchInput = useMemo(
    () => ({
      ...(usableTerm ? { q: usableTerm } : {}),
      ...(dayBoundary(fromDay, 'start') ? { from: dayBoundary(fromDay, 'start') } : {}),
      ...(dayBoundary(toDay, 'end') ? { to: dayBoundary(toDay, 'end') } : {}),
    }),
    [fromDay, usableTerm, toDay],
  );
  const hasQuery = Object.keys(searchInput).length > 0;
  // A term typed but not yet searched for still counts as "the reader is asking something", so
  // the panel keeps its idle prompt off screen while the burst settles.
  const typing = typed.length >= MIN_SEARCH_CHARS && typed !== usableTerm;

  const segments = useApiQuery(segmentsDef());
  const results = useApiListQuery({
    ...searchDef(searchInput),
    enabled: lens === 'search' && hasQuery,
  });

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <Toolbar
        controlSize="sm"
        leading={
          <>
            <Button
              type="button"
              variant={lens === 'topics' ? 'secondary' : 'ghost'}
              className="min-h-10"
              onClick={() => {
                setLens('topics');
              }}
            >
              <MessagesSquare aria-hidden="true" />
              Topics
            </Button>
            <Button
              type="button"
              variant={lens === 'search' ? 'secondary' : 'ghost'}
              className="min-h-10"
              onClick={() => {
                setLens('search');
              }}
            >
              <Search aria-hidden="true" />
              Find
            </Button>
          </>
        }
      />

      {lens === 'search' ? (
        <ControlGroup controlSize="sm" orientation="vertical" className="items-stretch">
          <Field label="Search this conversation">
            <Input
              variant="filled"
              type="search"
              value={term}
              placeholder="A word you remember…"
              onChange={(event) => {
                setTerm(event.target.value);
              }}
            />
          </Field>
          <ControlGroup controlSize="sm">
            <Field label="From">
              <DatePicker
                ariaLabel="From"
                placeholder="Any day"
                triggerVariant="outline"
                value={fromDay === '' ? null : fromDay}
                onChange={(next) => {
                  setFromDay(next ?? '');
                }}
              />
            </Field>
            <Field label="To">
              <DatePicker
                ariaLabel="To"
                placeholder="Any day"
                triggerVariant="outline"
                value={toDay === '' ? null : toDay}
                onChange={(next) => {
                  setToDay(next ?? '');
                }}
              />
            </Field>
          </ControlGroup>
        </ControlGroup>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lens === 'topics' ? (
          segments.isPending ? (
            <Text as="p" token="body-small" tone="muted">
              Working out what you have been talking about…
            </Text>
          ) : segments.isError ? (
            <Text as="p" token="body-small" tone="muted" role="status">
              Topics are temporarily unavailable. The conversation itself is unaffected.
            </Text>
          ) : segments.data.items.length === 0 ? (
            <Text as="p" token="body-small" tone="muted">
              Topics appear here on their own once you have talked for a while.
            </Text>
          ) : (
            <ul className="flex flex-col gap-1">
              {segments.data.items.map((segment) => (
                <li key={segment.id}>
                  <button
                    type="button"
                    onClick={() => onJump?.(segment.startActivityId)}
                    className="hover:bg-surface-container-high flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left"
                  >
                    <Text token="label-large" truncate className="w-full">
                      {segment.title}
                    </Text>
                    <Text token="label-small" tone="muted" numeric>
                      {new Intl.DateTimeFormat(undefined, {
                        month: 'short',
                        day: 'numeric',
                      }).format(new Date(segment.startedAt))}
                      {' · '}
                      {segment.messageCount} messages
                    </Text>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : !hasQuery && !typing ? (
          <Text as="p" token="body-small" tone="muted">
            <Calendar aria-hidden="true" className="mr-1 inline size-4 align-text-bottom" />
            Search by a word, a date range, or both.
          </Text>
        ) : typing || results.isPending ? (
          <Text as="p" token="body-small" tone="muted">
            Looking…
          </Text>
        ) : results.isError ? (
          <Text as="p" token="body-small" tone="muted" role="status">
            That search could not run. Try again in a moment.
          </Text>
        ) : results.data.items.length === 0 ? (
          <Text as="p" token="body-small" tone="muted" role="status">
            Nothing in this conversation matches that.
          </Text>
        ) : (
          <>
            <Text as="p" token="label-small" tone="muted" numeric>
              {results.data.total} matching {results.data.total === 1 ? 'message' : 'messages'}
            </Text>
            <ul className="mt-1 flex flex-col gap-1">
              {results.data.items.map((hit) => (
                <li key={hit.activityId}>
                  <button
                    type="button"
                    onClick={() => onJump?.(hit.activityId)}
                    className="hover:bg-surface-container-high flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left"
                  >
                    <Text token="body-small" className="line-clamp-2 w-full">
                      <Highlighted text={hit.text} spans={hit.highlights} />
                    </Text>
                    <Text token="label-small" tone="muted" numeric>
                      {hit.author === 'user' ? 'You' : 'Athena'}
                      {' · '}
                      {new Intl.DateTimeFormat(undefined, {
                        month: 'short',
                        day: 'numeric',
                      }).format(new Date(hit.createdAt))}
                    </Text>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export default AthenaConversationBrowser;
