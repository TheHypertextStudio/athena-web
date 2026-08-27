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
 * - **People you chose not to sync** — decided, so they leave the list above rather than sitting
 *   in it looking undecided. Collapsed and reversible: an exclusion nobody can find again is a
 *   decision you cannot take back.
 * - **Docket people with no Notion account** — *not* a problem, and saying so is the point. They
 *   still get a row in the projected People database and can be assigned work there; Notion simply
 *   cannot @-mention them, because its native people property only references Notion members.
 *   Left unexplained this reads as the sync having dropped somebody.
 */
import type { NotionWorkspacePerson } from '@docket/connections/notion/mirror-contract';
import { WriteError } from '../write-error';
import { CheckCircle2, CircleAlert, User, UserOff, Users } from '@docket/ui/icons';
import { EmptyState } from '@docket/ui/components';
import { Avatar, AvatarFallback, Button, Select, Skeleton } from '@docket/ui/primitives';
import NextLink from '@/components/docket-link';
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';

import { SettingsGroup } from '../settings-group';
import { IGNORED_DETAIL, UNIGNORE_ACTION, ignoredTitle } from './notion-copy';
import { useNotionPeople, type PersonDecision } from './use-notion-mirror-controller';

/** Props for {@link NotionPeoplePanel}. */
export interface NotionPeoplePanelProps {
  orgId: string;
  integrationId: string;
  /**
   * Whether the caller may change this workspace's Notion setup.
   *
   * @remarks
   * Every write behind this surface is guarded server-side at `manage`
   * (`apps/api/src/routes/notion-mirror.ts`). Rendering the controls regardless meant a
   * contributor could press "Create databases" and receive a bare 403 with nothing explaining
   * it. Read stays available to everyone; only the write affordances are withheld.
   */
  canManage: boolean;
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
export function NotionPeoplePanel({
  orgId,
  integrationId,
  canManage,
}: NotionPeoplePanelProps): JSX.Element {
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
    return <WriteError message={people.error} />;
  }

  // `ignored` counts too: a workspace whose every Notion member was skipped has still been seen,
  // and telling that reader "no Notion people yet" would deny the decisions they just made.
  const nothingSeen =
    people.matched.length === 0 &&
    people.unmatched.length === 0 &&
    people.ignored.length === 0 &&
    people.docketOnly === 0;

  if (nothingSeen) {
    return (
      <SettingsGroup>
        <EmptyState
          icon={Users}
          title="No Notion people yet"
          body="Docket learns who is in your Notion workspace on the first sync. Run one and everyone shows up here to be matched."
          frame="none"
          action={
            <Button asChild variant="outline">
              <NextLink href={`/orgs/${orgId}/settings/connections/notion`}>
                Go to Notion sync
              </NextLink>
            </Button>
          }
        />
      </SettingsGroup>
    );
  }

  return (
    <div className="@container flex flex-col gap-4">
      {people.unmatched.length > 0 ? (
        <SettingsGroup className="overflow-hidden" body="rows">
          <div className="bg-surface-container flex items-center gap-2 px-4 py-2.5">
            <CircleAlert aria-hidden="true" className="text-error size-4" />
            <span className="text-on-surface text-label-large">
              {people.unmatched.length === 1
                ? '1 person to sort out'
                : `${String(people.unmatched.length)} people to sort out`}
            </span>
          </div>
          <p className="text-on-surface-variant text-body-small px-4 py-2">
            These people work in your Notion workspace but Docket doesn’t know who they are. Until
            you say, anything assigned to them in Notion can’t reach Docket.
          </p>
          <ul aria-label="People who need a decision">
            {people.unmatched.map((person) => (
              <UnmatchedRow
                key={person.externalId}
                name={person.name}
                email={person.email}
                busy={people.resolving === person.externalId}
                roster={people.roster}
                canManage={canManage}
                onDecide={(decision) => {
                  people.resolve(person.externalId, decision);
                }}
              />
            ))}
          </ul>
        </SettingsGroup>
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

      {people.ignored.length > 0 ? (
        <Summary
          icon={<UserOff aria-hidden="true" className="text-on-surface-variant size-4" />}
          title={ignoredTitle(people.ignored.length)}
          detail={IGNORED_DETAIL}
        >
          <ul>
            {people.ignored.map((person) => (
              <IgnoredRow
                key={person.externalId}
                person={person}
                busy={people.resolving === person.externalId}
                canManage={canManage}
                onRestore={() => {
                  people.resolve(person.externalId, { action: 'unignore' });
                }}
              />
            ))}
          </ul>
        </Summary>
      ) : null}

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
  canManage: boolean;
}): JSX.Element {
  const [choice, setChoice] = useState('create_actor');

  return (
    <li className="bg-surface-container-low flex flex-col gap-3 px-4 py-3 @xl:flex-row @xl:items-center">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="text-body-small">{initials(props.name)}</AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-on-surface text-body-medium truncate">{props.name}</span>
        <span className="text-on-surface-variant text-body-small truncate">
          {props.email ?? 'No email in Notion'}
        </span>
      </span>
      {props.canManage ? (
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
                props.onDecide({
                  action: 'match_existing',
                  actorId: choice.slice('match:'.length),
                });
            }}
          >
            {props.busy ? 'Saving…' : 'Apply'}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * A quiet, collapsed group: a count and one line of context.
 *
 * @remarks
 * With `children` the whole thing becomes a native `<details>` — a disclosure rather than a static
 * block. Native for the same reason the hub's preview is: it holds no state worth owning, and
 * `<details>` is keyboard- and screen-reader-complete without any.
 *
 * The heading stays identical either way, so a group that happens to have something inside it does
 * not become visually louder than one that does not. These groups are the resolved part of the
 * page; the unresolved part above them is what should draw the eye.
 */
function Summary(props: {
  icon: JSX.Element;
  title: string;
  detail: string;
  children?: ReactNode;
}): JSX.Element {
  const heading = (
    <>
      <p className="text-on-surface text-label-large flex items-center gap-2">
        {props.icon}
        {props.title}
      </p>
      <p className="text-on-surface-variant text-body-small mt-1 max-w-prose pl-6">
        {props.detail}
      </p>
    </>
  );

  if (props.children === undefined) {
    return (
      <SettingsGroup body="rows">
        <div className="px-4 py-3">{heading}</div>
      </SettingsGroup>
    );
  }

  return (
    <details className="bg-surface-container-low overflow-hidden rounded-xl">
      <summary className="cursor-pointer list-none px-4 py-3 marker:content-none">
        {heading}
      </summary>
      {props.children}
    </details>
  );
}

/**
 * One person who was deliberately excluded, with the way back.
 *
 * @remarks
 * The undo lives on the row rather than behind a bulk action for the same reason the decision
 * does: exclusions are made one person at a time and reversed the same way. Without it, "Don't
 * sync them" would be a one-way door — and a decision that cannot be revisited is one people are
 * right to hesitate over.
 */
function IgnoredRow(props: {
  person: NotionWorkspacePerson;
  busy: boolean;
  onRestore: () => void;
  canManage: boolean;
}): JSX.Element {
  return (
    <li className="bg-surface-container-low flex items-center gap-3 px-4 py-3">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="text-body-small">{initials(props.person.name)}</AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-on-surface text-body-medium truncate">{props.person.name}</span>
        <span className="text-on-surface-variant text-body-small truncate">
          {props.person.email ?? 'No email in Notion'}
        </span>
      </span>
      {props.canManage ? (
        <Button variant="outline" disabled={props.busy} onClick={props.onRestore}>
          {UNIGNORE_ACTION}
        </Button>
      ) : null}
    </li>
  );
}
