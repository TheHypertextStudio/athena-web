'use client';

/**
 * A person's workspace profile — who they are and what they are carrying.
 *
 * @remarks
 * Every human Actor in a workspace has one of these, and every one of them resolves. That is the
 * requirement (ENT-43): a roster row must never lead to a 404 or a shrug, whether the person
 * behind it signs in or not.
 *
 * The profile answers three questions, in the order someone actually asks them: who is this, what
 * do they do here (their role), and what are they on the hook for (assigned tasks, projects they
 * lead, initiatives they own). It reports nothing about accounts, sign-in, or invitations —
 * there is no field in the payload to report and no line of copy that would land differently for
 * a volunteer than for staff.
 *
 * The name is editable in place for anyone with `manage`, because for someone without an account
 * this workspace is the only place their name exists — an uneditable name would be exactly the
 * kind of "functional for members, read-only for everyone else" divergence that makes a person
 * feel like a record rather than a participant.
 *
 * @see {@link file://../../../../../docs/engineering/specs/people.md}
 */
import { ActorAvatar } from '@docket/ui/components';
import { FolderKanban, ListChecks, Target } from '@docket/ui/icons';
import { Badge, Button, Input, Skeleton, Text } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, type ReactNode, useEffect, useState } from 'react';

import { useApiQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

import { personProfileQuery, useRenamePerson } from './people-queries';

/** Props for {@link PersonProfileView}. */
export interface PersonProfileViewProps {
  /** The workspace the person belongs to. */
  readonly orgId: string;
  /** The person's Actor id. */
  readonly actorId: string;
  /** Whether the caller may edit this workspace's people. */
  readonly canManage: boolean;
}

/** A titled group of work the person is responsible for. */
function WorkSection({
  icon,
  title,
  emptyCopy,
  children,
  count,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly emptyCopy: string;
  readonly children: ReactNode;
  readonly count: number;
}): JSX.Element {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-on-surface-variant [&>svg]:size-4">
          {icon}
        </span>
        <Text as="h2" token="title-small">
          {title}
        </Text>
        <Text as="span" token="label-small" tone="muted" numeric>
          {count}
        </Text>
      </div>
      {count === 0 ? (
        <Text as="p" token="body-small" tone="muted">
          {emptyCopy}
        </Text>
      ) : (
        <ul className="bg-surface-container-low divide-outline-variant/50 flex flex-col divide-y overflow-hidden rounded-xl">
          {children}
        </ul>
      )}
    </section>
  );
}

/** One linked line of work inside a {@link WorkSection}. */
function WorkRow({
  href,
  label,
  trailing,
}: {
  readonly href: string;
  readonly label: string;
  readonly trailing?: ReactNode;
}): JSX.Element {
  return (
    <li className="hover:bg-surface-container-high flex min-h-11 items-center gap-3 px-4 py-2 transition-colors">
      <Link
        href={href}
        className="focus-visible:ring-ring min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2"
      >
        <Text as="span" token="body-medium" truncate>
          {label}
        </Text>
      </Link>
      {trailing}
    </li>
  );
}

/**
 * The person profile surface.
 *
 * @param props - The {@link PersonProfileViewProps}.
 * @returns the rendered profile.
 */
export function PersonProfileView({
  orgId,
  actorId,
  canManage,
}: PersonProfileViewProps): JSX.Element {
  const profileQ = useApiQuery(personProfileQuery(orgId, actorId));
  const rename = useRenamePerson(orgId, actorId);
  const [draftName, setDraftName] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const profile = profileQ.data;

  // Drop a stale draft whenever the server's name changes underneath (another editor, a refetch).
  useEffect(() => {
    setDraftName(null);
    setRenameError(null);
  }, [profile?.displayName]);

  if (profileQ.isPending) {
    // placeholder: the person's identity and their three work lists — none of it knowable before
    // the read resolves. The page frame around it is static and already painted.
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-7 w-48" />
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (profileQ.isError || !profile) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8">
        <Text
          as="p"
          role="alert"
          token="body-medium"
          className="bg-surface-container-low rounded-xl p-4"
        >
          {userErrorMessage(profileQ.error, 'We could not open this person right now.')}
        </Text>
        <Link href={`/orgs/${orgId}/people`} className="text-primary text-body-medium">
          Back to People
        </Link>
      </div>
    );
  }

  const editing = draftName !== null;

  async function saveName(next: string): Promise<void> {
    setRenameError(null);
    try {
      await rename.mutateAsync(next.trim());
      setDraftName(null);
    } catch (caught) {
      setRenameError(userErrorMessage(caught, 'Could not save this name.'));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3">
        <Link href={`/orgs/${orgId}/people`} className="text-on-surface-variant text-body-small">
          People
        </Link>
        <div className="flex items-center gap-4">
          <ActorAvatar
            kind="human"
            name={profile.displayName}
            avatarUrl={profile.avatar}
            size={56}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {editing ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveName(draftName);
                }}
              >
                <Input
                  aria-label="Name"
                  controlSize="lg"
                  value={draftName}
                  autoFocus
                  maxLength={120}
                  disabled={rename.isPending}
                  onChange={(event) => {
                    setDraftName(event.target.value);
                  }}
                />
                <Button
                  type="submit"
                  controlSize="lg"
                  disabled={draftName.trim().length === 0 || rename.isPending}
                >
                  {rename.isPending ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  controlSize="lg"
                  disabled={rename.isPending}
                  onClick={() => {
                    setDraftName(null);
                    setRenameError(null);
                  }}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex min-w-0 items-center gap-3">
                <Text as="h1" token="headline-small" truncate>
                  {profile.displayName}
                </Text>
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setDraftName(profile.displayName);
                    }}
                  >
                    Rename
                  </Button>
                ) : null}
              </div>
            )}
            <div className="flex items-center gap-2">
              {profile.roleName ? (
                <Text as="span" token="body-medium" tone="muted">
                  {profile.roleName}
                </Text>
              ) : null}
              {profile.status === 'suspended' ? <Badge variant="secondary">Suspended</Badge> : null}
            </div>
          </div>
        </div>
        {renameError ? (
          <Text as="p" role="alert" token="body-small" tone="error">
            {renameError}
          </Text>
        ) : null}
      </header>

      <WorkSection
        icon={<ListChecks />}
        title="Assigned tasks"
        count={profile.assignedTasks.length}
        emptyCopy="Nothing is assigned to them right now."
      >
        {profile.assignedTasks.map((task) => (
          <WorkRow
            key={task.id}
            href={`/orgs/${orgId}/tasks/${task.id}`}
            label={task.title}
            trailing={
              <Text as="span" token="body-small" tone="muted" className="shrink-0">
                {task.state}
              </Text>
            }
          />
        ))}
      </WorkSection>

      <WorkSection
        icon={<FolderKanban />}
        title="Projects they lead"
        count={profile.ledProjects.length}
        emptyCopy="They aren't leading a project yet."
      >
        {profile.ledProjects.map((project) => (
          <WorkRow
            key={project.id}
            href={`/orgs/${orgId}/projects/${project.id}`}
            label={project.name}
            trailing={
              <Text as="span" token="body-small" tone="muted" className="shrink-0">
                {project.status}
              </Text>
            }
          />
        ))}
      </WorkSection>

      <WorkSection
        icon={<Target />}
        title="Initiatives they own"
        count={profile.ownedInitiatives.length}
        emptyCopy="They don't own an initiative yet."
      >
        {profile.ownedInitiatives.map((initiative) => (
          <WorkRow
            key={initiative.id}
            href={`/orgs/${orgId}/initiatives/${initiative.id}`}
            label={initiative.name}
            trailing={
              <Text as="span" token="body-small" tone="muted" className="shrink-0">
                {initiative.status}
              </Text>
            }
          />
        ))}
      </WorkSection>
    </div>
  );
}
