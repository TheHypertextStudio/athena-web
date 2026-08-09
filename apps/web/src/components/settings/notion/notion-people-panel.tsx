'use client';

/**
 * `settings/notion` — who is who across Notion and Docket.
 *
 * @remarks
 * Three populations, and the surface exists because they are genuinely different problems rather
 * than one list with a status column:
 *
 * - **Matched** — quiet. Nothing to do; collapsed to a count so it does not crowd out the rest.
 * - **Unmatched Notion people** — the only group needing a decision, and the only one whose
 *   absence has a consequence worth stating: their assignments cannot reach Docket.
 * - **Docket people with no Notion account** — *not* a problem, and saying so is the point. They
 *   still get a row in the projected People database and can be assigned work there; Notion simply
 *   cannot @-mention them, because its native people property only references Notion members.
 *   Left unexplained this reads as the sync having dropped somebody.
 */
import { cn } from '@docket/ui';
import { CheckCircle2, CircleAlert, User } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { useNotionPeople } from './use-notion-mirror-controller';

/** Props for {@link NotionPeoplePanel}. */
export interface NotionPeoplePanelProps {
  orgId: string;
  integrationId: string;
}

/** Initials for an avatar chip, from a display name. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** The Notion ↔ Docket identity surface. */
export function NotionPeoplePanel({ orgId, integrationId }: NotionPeoplePanelProps): JSX.Element {
  const people = useNotionPeople(orgId, integrationId);

  if (people.loading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {/* placeholder: the external_actor mappings, which only the server has. */}
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  if (people.error !== null) {
    return (
      <p role="alert" className="text-error text-body-medium">
        {people.error}
      </p>
    );
  }

  const nothingSeen =
    people.matched.length === 0 && people.unmatched.length === 0 && people.docketOnly === 0;

  if (nothingSeen) {
    return (
      <div className="border-outline-variant rounded-xl border border-dashed p-6">
        <p className="text-on-surface text-label-large">No Notion people yet</p>
        <p className="text-on-surface-variant text-body-small mt-1 max-w-prose">
          Docket learns who is in your Notion workspace on the first sync. Once the databases exist
          and a sync has run, everyone shows up here to be matched.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-on-surface-variant text-body-small max-w-prose">
        {people.matched.length} matched by email · {people.unmatched.length} need a decision ·{' '}
        {people.docketOnly} in Docket only
      </p>

      {people.unmatched.length > 0 ? (
        <section
          className="border-outline-variant overflow-hidden rounded-xl border"
          aria-label="People who need a decision"
        >
          <div className="bg-surface-container flex items-center gap-2 px-4 py-2.5">
            <CircleAlert aria-hidden="true" className="text-error size-4" />
            <span className="text-on-surface text-label-large">
              {people.unmatched.length === 1
                ? '1 person needs a decision'
                : `${String(people.unmatched.length)} people need a decision`}
            </span>
          </div>
          <p className="text-on-surface-variant text-body-small border-outline-variant border-t px-4 py-2">
            Until these are matched, anything assigned to them in Notion can’t reach Docket.
          </p>
          <ul>
            {people.unmatched.map((person) => (
              <li
                key={person.externalId}
                className="border-outline-variant bg-surface-container-low flex items-center gap-3 border-t px-4 py-3"
              >
                <span className="bg-surface-container text-on-surface-variant text-body-small flex size-8 shrink-0 items-center justify-center rounded-full">
                  {initials(person.name)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-on-surface text-body-medium truncate">{person.name}</span>
                  <span className="text-on-surface-variant text-body-small truncate">
                    {person.email ?? 'No email in Notion'} · in Notion only
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Summary
        icon={<CheckCircle2 aria-hidden="true" className="text-tertiary size-4" />}
        title={`${String(people.matched.length)} matched by email`}
        detail={
          people.matched.length === 0
            ? 'Nobody has been matched automatically yet.'
            : people.matched
                .slice(0, 3)
                .map((p) => p.name)
                .join(', ') + (people.matched.length > 3 ? ', and more' : '')
        }
      />

      <Summary
        icon={<User aria-hidden="true" className="text-on-surface-variant size-4" />}
        title={`${String(people.docketOnly)} have no Notion account`}
        detail="They still get a row in the People database and can be assigned work there — Notion just can’t @-mention them."
      />
    </div>
  );
}

/** A quiet, collapsed group: a count and one line of context. */
function Summary(props: { icon: JSX.Element; title: string; detail: string }): JSX.Element {
  return (
    <section className={cn('border-outline-variant rounded-xl border px-4 py-3')}>
      <p className="text-on-surface text-label-large flex items-center gap-2">
        {props.icon}
        {props.title}
      </p>
      <p className="text-on-surface-variant text-body-small mt-1 max-w-prose pl-6">
        {props.detail}
      </p>
    </section>
  );
}
