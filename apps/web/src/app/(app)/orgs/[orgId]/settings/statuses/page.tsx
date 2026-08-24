'use client';

/**
 * Manage the workspace's statuses.
 *
 * @remarks
 * Reads the org id from the generated typed route rather than Next's `params` promise, matching every other
 * settings page — the offline route table mounts routes with no props at all.
 *
 * The four sets live on one page because they share one taxonomy, and seeing them together is what
 * makes that legible. The Task section is the only one that can be scoped to a team, since Tasks
 * are the only work a team owns.
 */
import type {
  TeamOut,
  WorkStatusCategory,
  WorkStatusCreate,
  WorkStatusEntityType,
} from '@docket/types';
import { useVocabulary } from '@docket/ui/hooks';
import { Skeleton } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { LoadFailure } from '@/components/settings/load-failure';
import { firstWriteError, WriteError } from '@/components/settings/write-error';
import { userErrorMessage } from '@/lib/problem';
import { useActiveOrg } from '@/components/active-org';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { DeleteStatusDialog } from '@/components/statuses/delete-status-dialog';
import {
  statusSetsDef,
  useCreateStatus,
  useDeleteStatus,
  useForkTeamStatuses,
  useReorderStatuses,
  useResetTeamStatuses,
  useUpdateStatus,
} from '@/components/statuses/queries';
import { StatusEditorDialog } from '@/components/statuses/status-editor-dialog';
import { StatusEntitySection, type TeamChoice } from '@/components/statuses/status-entity-section';
import type { StatusLike } from '@/components/statuses/status-registry';
import { api } from '@/lib/api';
import { useTypedRoute } from '@/lib/app-location';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery, useApiQuery } from '@/lib/query';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** Which status the editor is open on, and which set and category it would be created into. */
interface EditorTarget {
  status: StatusLike | null;
  entityType: WorkStatusEntityType;
  category: WorkStatusCategory;
}

/** Which status is being deleted, and which set it belongs to. */
interface DeleteTarget {
  status: StatusLike;
  entityType: WorkStatusEntityType;
}

/**
 * The settings surface for a workspace's statuses.
 *
 * @returns the page element.
 */
export default function StatusesSettingsPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/settings/statuses');
  const { activeOrg } = useActiveOrg();
  const { canManage } = useCanManageOrg(orgId);

  const taskWord = useVocabulary('task', { plural: true });
  const projectWord = useVocabulary('project', { plural: true });
  const programWord = useVocabulary('program', { plural: true });
  const initiativeWord = useVocabulary('initiative', { plural: true });
  // A section heads a set, so it takes the plural; a dialog acts on one status, so it takes the
  // singular — "New task status" rather than "New Tasks status".
  const taskOne = useVocabulary('task');
  const projectOne = useVocabulary('project');
  const programOne = useVocabulary('program');
  const initiativeOne = useVocabulary('initiative');

  // A personal workspace is an org of one, and its team is an implementation detail its owner
  // should never have to meet — so the whole team axis is absent there.
  const isPersonal = activeOrg?.isPersonal ?? false;
  // Branded to match the DTOs: the id came from a `TeamOut`, so it is a `TeamId` all along.
  type ScopedTeamId = NonNullable<WorkStatusCreate['teamId']>;
  const [scopeTeamId, setScopeTeamId] = useState<ScopedTeamId | null>(null);

  const setsQ = useApiQuery(statusSetsDef(orgId, scopeTeamId ?? undefined));
  const teamsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.teams(orgId),
      () => api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }),
      'Could not load teams.',
      { enabled: !isPersonal, staleTime: STALE.static },
    ),
  );

  const createStatus = useCreateStatus(orgId);
  const updateStatus = useUpdateStatus(orgId);
  const reorderStatuses = useReorderStatuses(orgId);
  const deleteStatus = useDeleteStatus(orgId);
  const forkTeam = useForkTeamStatuses(orgId);
  const resetTeam = useResetTeamStatuses(orgId);

  const writeError = firstWriteError([
    [createStatus, 'Could not create that status.'],
    [updateStatus, 'Could not save that status.'],
    [reorderStatuses, 'Could not reorder statuses.'],
    [deleteStatus, 'Could not delete that status.'],
    [forkTeam, 'Could not give this team its own statuses.'],
    [resetTeam, 'Could not return this team to the workspace statuses.'],
  ]);

  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);

  const sets = setsQ.data?.items ?? [];
  // The workspace's own four sets; the read also carries one entry per team that keeps its own
  // Task statuses, which is what lets the team menu say which teams differ.
  const setFor = (entityType: WorkStatusEntityType): readonly StatusLike[] =>
    sets.find((set) => set.entityType === entityType && set.teamId === null)?.statuses ?? [];
  const scopedTaskSet = sets.find(
    (set) => set.entityType === 'task' && set.teamId === (scopeTeamId ?? null),
  );
  const forkedTeamIds = new Set(sets.filter((set) => set.teamId !== null).map((set) => set.teamId));

  const teams: readonly TeamOut[] = teamsQ.data?.items ?? [];
  // Forking away from a set nobody else holds is a decision with no meaning, so the selector needs
  // a second team before it earns its place.
  const teamChoices: readonly TeamChoice[] =
    isPersonal || teams.length < 2
      ? []
      : teams.map((team) => ({
          id: team.id,
          name: team.name,
          forked: forkedTeamIds.has(team.id),
        }));

  const reorderWithin = (
    entityType: WorkStatusEntityType,
    category: WorkStatusCategory,
    statusId: string,
    toIndex: number,
  ): void => {
    const all = setFor(entityType);
    const inCategory = all.filter((status) => status.category === category);
    const from = inCategory.findIndex((status) => status.id === statusId);
    if (from === -1) return;
    const moved = [...inCategory];
    const [lifted] = moved.splice(from, 1);
    if (lifted === undefined) return;
    moved.splice(toIndex, 0, lifted);
    // The endpoint takes the whole set in its new order, so untouched categories keep their places
    // and only this one is rewritten. Sending the whole set also makes a retry idempotent.
    reorderStatuses.mutate({
      entityType,
      ...(scopeTeamId === null || entityType !== 'task' ? {} : { teamId: scopeTeamId }),
      order: rebuildOrder(all, category, moved).map((status) => status.id),
    });
  };

  const sections: {
    entityType: WorkStatusEntityType;
    title: string;
    one: string;
    description: string;
  }[] = [
    {
      entityType: 'task',
      title: taskWord,
      one: taskOne,
      description: 'The columns work moves through day to day.',
    },
    {
      entityType: 'project',
      title: projectWord,
      one: projectOne,
      description: 'How a bounded effort reads from proposal to delivery.',
    },
    {
      entityType: 'program',
      title: programWord,
      one: programOne,
      description: 'How an ongoing area of work reads, including when it ends.',
    },
    {
      entityType: 'initiative',
      title: initiativeWord,
      one: initiativeOne,
      description: 'How a strategic theme reads while it is being pursued.',
    },
  ];

  return (
    <SettingsSectionPage
      title="Statuses"
      description="The states work moves through. Rename them to match how your workspace talks."
    >
      {writeError ? <WriteError message={writeError} /> : null}
      {setsQ.isPending ? (
        <Skeleton className="h-[36rem] max-w-3xl rounded-xl" />
      ) : setsQ.isError ? (
        <LoadFailure message={userErrorMessage(setsQ.error, 'Could not load statuses.')} retrying />
      ) : (
        <div className="flex max-w-3xl min-w-0 flex-col gap-10">
          {sections.map((section) => (
            <StatusEntitySection
              key={section.entityType}
              entityType={section.entityType}
              title={section.title}
              description={section.description}
              statuses={
                section.entityType === 'task' && scopeTeamId !== null
                  ? (scopedTaskSet?.statuses ?? setFor('task'))
                  : setFor(section.entityType)
              }
              canManage={canManage}
              {...(section.entityType === 'task'
                ? {
                    teams: teamChoices,
                    scopeTeamId,
                    scopeForked: scopeTeamId !== null && forkedTeamIds.has(scopeTeamId),
                    onScopeChange: (teamId: string | null) => {
                      setScopeTeamId(teamId as ScopedTeamId | null);
                    },
                    onFork: () => {
                      if (scopeTeamId !== null) forkTeam.mutate(scopeTeamId);
                    },
                    onReset: () => {
                      if (scopeTeamId !== null) resetTeam.mutate(scopeTeamId);
                    },
                  }
                : {})}
              onAdd={(category) => {
                setEditing({ status: null, entityType: section.entityType, category });
              }}
              onEdit={(status) => {
                setEditing({ status, entityType: section.entityType, category: status.category });
              }}
              onMakeDefault={(status) => {
                updateStatus.mutate({ statusId: status.id, isDefault: true });
              }}
              onDelete={(status) => {
                setDeleting({ status, entityType: section.entityType });
              }}
              onReorder={(category, statusId, toIndex) => {
                reorderWithin(section.entityType, category, statusId, toIndex);
              }}
            />
          ))}
        </div>
      )}

      {editing === null ? null : (
        <StatusEditorDialog
          status={editing.status}
          initialCategory={editing.category}
          entityLabel={
            sections.find((section) => section.entityType === editing.entityType)?.one ?? 'work'
          }
          pending={createStatus.isPending || updateStatus.isPending}
          error={createStatus.error ?? updateStatus.error}
          onSave={(input) => {
            if (editing.status === null) {
              createStatus.mutate(
                {
                  entityType: editing.entityType,
                  ...(scopeTeamId === null || editing.entityType !== 'task'
                    ? {}
                    : { teamId: scopeTeamId }),
                  name: input.name,
                  description: input.description,
                  category: input.category,
                },
                {
                  onSuccess: () => {
                    setEditing(null);
                  },
                },
              );
            } else {
              updateStatus.mutate(
                {
                  statusId: editing.status.id,
                  name: input.name,
                  description: input.description,
                  category: input.category,
                },
                {
                  onSuccess: () => {
                    setEditing(null);
                  },
                },
              );
            }
          }}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}

      {deleting === null ? null : (
        <DeleteStatusDialog
          status={deleting.status}
          candidates={setFor(deleting.entityType).filter(
            (status) => status.id !== deleting.status.id,
          )}
          pending={deleteStatus.isPending}
          error={deleteStatus.error}
          onConfirm={(remapTo) => {
            deleteStatus.mutate(
              { statusId: deleting.status.id, remapTo },
              {
                onSuccess: () => {
                  setDeleting(null);
                },
              },
            );
          }}
          onClose={() => {
            setDeleting(null);
          }}
        />
      )}
    </SettingsSectionPage>
  );
}

/** Rebuild a whole set with one category's rows in a new order, keeping the categories in place. */
function rebuildOrder(
  all: readonly StatusLike[],
  category: WorkStatusCategory,
  reordered: readonly StatusLike[],
): readonly StatusLike[] {
  const queue = [...reordered];
  return all.map((status) => (status.category === category ? (queue.shift() ?? status) : status));
}
