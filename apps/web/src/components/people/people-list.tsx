'use client';

/**
 * The workspace People roster — everyone this workspace tracks, in one list.
 *
 * @remarks
 * One list, name-ordered, with no sections. That is the whole design, and it is load-bearing:
 * the author's requirement is that "all actors are treated equally from a UI and UX perspective
 * unless there are clear and convincing reasons not to", and a roster that separates "Members"
 * from "People without accounts" is precisely the second-class treatment being ruled out. The
 * server returns the roster already sorted by name (`GET /v1/orgs/:orgId/members`); this surface
 * renders that order verbatim rather than re-sorting or partitioning it.
 *
 * Two ways to add someone sit side by side in the toolbar, phrased as peers: **Add person**
 * records someone who will not sign in, and **Invite** (Settings → Members & Access) sends an
 * email to someone who will. Neither is the "real" one.
 *
 * The roster is deliberately not shown for a personal workspace: a personal space is an
 * org-of-one, and its org backing is an implementation detail the reader should never meet.
 *
 * @see {@link file://../../../../../docs/engineering/specs/people.md}
 */
import { EmptyState } from '@docket/ui/components';
import { Plus, Users } from '@docket/ui/icons';
import { Button, Skeleton, Text, Toolbar } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { type JSX, useMemo, useState } from 'react';

import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { useApiListQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

import { AddPersonDialog, type PersonRoleOption } from './add-person-dialog';
import { peopleQuery, rolesQuery } from './people-queries';
import { PersonRow, type PersonRowModel } from './person-row';

/** Props for {@link PeopleList}. */
export interface PeopleListProps {
  /** The workspace whose roster is shown. */
  readonly orgId: string;
}

/**
 * The People roster surface.
 *
 * @param props - The {@link PeopleListProps}.
 * @returns the rendered roster.
 */
export function PeopleList({ orgId }: PeopleListProps): JSX.Element {
  const [addOpen, setAddOpen] = useState(false);

  const peopleQ = useApiListQuery(peopleQuery(orgId));
  const rolesQ = useApiListQuery(rolesQuery(orgId));

  const people = useMemo(() => peopleQ.data?.items ?? [], [peopleQ.data]);
  const roles = useMemo(() => rolesQ.data?.items ?? [], [rolesQ.data]);

  /** Resolve each role id to the workspace's own name for it. */
  const roleNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const role of roles) byId.set(role.id, role.name);
    return byId;
  }, [roles]);

  const rows = useMemo<readonly PersonRowModel[]>(
    () =>
      people.map((person) => ({
        actorId: person.actorId,
        displayName: person.displayName,
        avatar: person.avatar ?? null,
        status: person.status,
        roleName: person.roleId ? (roleNameById.get(person.roleId) ?? null) : null,
      })),
    [people, roleNameById],
  );

  // The same owner/admin gate the API enforces, resolved from the members + roles reads this
  // surface already holds — the hook shares their cache keys, so it costs no extra request.
  const { canManage } = useCanManageOrg(orgId);

  const roleOptions = useMemo<readonly PersonRoleOption[]>(
    () => roles.map((role) => ({ id: role.id, name: role.name })),
    [roles],
  );
  const defaultRoleId = useMemo(
    () => roles.find((role) => role.key === 'member')?.id ?? null,
    [roles],
  );

  const loading = peopleQ.isPending;
  const loadError = peopleQ.isError
    ? userErrorMessage(peopleQ.error, 'Could not load the people in this workspace.')
    : null;

  return (
    <div className="flex w-full flex-col gap-4 px-3 py-4 @2xl:gap-5 @2xl:p-6 @4xl:p-8">
      {/* The title and the actions share the toolbar row; the explainer sits on its own line
          beneath it. Putting it inside the leading slot squeezed it into a five-line column
          beside the buttons at 390px — a toolbar has two edges, not a place for a paragraph. */}
      <Toolbar
        leading={
          <Text as="h1" token="headline-small" truncate>
            People
          </Text>
        }
        trailing={
          canManage ? (
            <>
              <Button variant="ghost" asChild>
                <Link href={`/orgs/${orgId}/settings/members`}>Invite by email</Link>
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setAddOpen(true);
                }}
              >
                <Plus aria-hidden="true" />
                Add person
              </Button>
            </>
          ) : null
        }
      />
      {canManage ? (
        <AddPersonDialog
          orgId={orgId}
          open={addOpen}
          onOpenChange={setAddOpen}
          roleOptions={roleOptions}
          defaultRoleId={defaultRoleId}
        />
      ) : null}

      {loading ? (
        // placeholder: the roster itself. Its length and its names are the only unknowns; the
        // heading, the copy and the actions above are all static and already painted.
        <div className="flex flex-col gap-px overflow-hidden">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-14 w-full rounded-none" />
          ))}
        </div>
      ) : loadError ? (
        <Text as="p" role="alert" token="body-medium" className="text-error p-4">
          {loadError}
        </Text>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No one here yet"
          {...(canManage
            ? {
                cta: {
                  label: 'Add the first person',
                  onClick: () => {
                    setAddOpen(true);
                  },
                },
              }
            : {})}
        />
      ) : (
        <ul
          aria-label="People"
          className="divide-outline-variant/50 flex flex-col divide-y overflow-hidden"
        >
          {rows.map((person) => (
            <PersonRow
              key={person.actorId}
              person={person}
              href={`/orgs/${orgId}/people/${person.actorId}`}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
