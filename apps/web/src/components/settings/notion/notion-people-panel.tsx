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
import { Button, Select, Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useState } from 'react';

import { useNotionPeople, type PersonDecision } from './use-notion-mirror-controller';

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
    <div className="@container flex flex-col gap-4">
      {people.unmatched.length > 0 ? (
        <section
          className="border-outline-variant overflow-hidden rounded-xl border"
          aria-label="People who need a decision"
        >
          <div className="bg-surface-container flex items-center gap-2 px-4 py-2.5">
            <CircleAlert aria-hidden="true" className="text-error size-4" />
            <span className="text-on-surface text-label-large">
              {people.unmatched.length === 1
                ? '1 person to sort out'
                : `${String(people.unmatched.length)} people to sort out`}
            </span>
          </div>
          <p className="text-on-surface-variant text-body-small border-outline-variant border-t px-4 py-2">
            These people work in your Notion workspace but Docket doesn’t know who they are. Until
            you say, anything assigned to them in Notion can’t reach Docket.
          </p>
          <ul>
            {people.unmatched.map((person) => (
              <UnmatchedRow
                key={person.externalId}
                name={person.name}
                email={person.email}
                busy={people.resolving === person.externalId}
                roster={people.roster}
                onDecide={(decision) => {
                  people.resolve(person.externalId, decision);
                }}
              />
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

/**
 * One unmatched person, with the decision attached to them.
 *
 * @remarks
 * The decision lives on the row rather than behind a modal because there is usually more than one
 * to make and they are independent: a dialog per person would turn a two-minute pass into twenty
 * clicks. "Add to Docket" is first because it is overwhelmingly the common answer — most people in
 * a Notion workspace have never used Docket, and adding them as a person with no account is what
 * makes their assignments routable at all.
 */
function UnmatchedRow(props: {
  name: string;
  email: string | null;
  busy: boolean;
  roster: readonly { id: string; displayName: string }[];
  onDecide: (decision: PersonDecision) => void;
}): JSX.Element {
  const [choice, setChoice] = useState('create_actor');

  return (
    <li className="border-outline-variant bg-surface-container-low flex flex-col gap-3 border-t px-4 py-3 @xl:flex-row @xl:items-center">
      <span className="bg-surface-container text-on-surface-variant text-body-small flex size-8 shrink-0 items-center justify-center rounded-full">
        {initials(props.name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-on-surface text-body-medium truncate">{props.name}</span>
        <span className="text-on-surface-variant text-body-small truncate">
          {props.email ?? 'No email in Notion'}
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Select
          aria-label={`What should Docket do about ${props.name}?`}
          value={choice}
          disabled={props.busy}
          onChange={(e) => {
            setChoice(e.target.value);
          }}
          className="w-56"
        >
          <option value="create_actor">Add to Docket as a new person</option>
          <option value="skip">Don’t sync them</option>
          {props.roster.map((member) => (
            <option key={member.id} value={`match:${member.id}`}>
              This is {member.displayName}
            </option>
          ))}
        </Select>
        <Button
          disabled={props.busy}
          onClick={() => {
            if (choice === 'create_actor') props.onDecide({ action: 'create_actor' });
            else if (choice === 'skip') props.onDecide({ action: 'skip' });
            else
              props.onDecide({ action: 'match_existing', actorId: choice.slice('match:'.length) });
          }}
        >
          {props.busy ? 'Saving…' : 'Apply'}
        </Button>
      </div>
    </li>
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
