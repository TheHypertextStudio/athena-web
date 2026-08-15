'use client';

/**
 * Settings → Labels: where the workspace's own vocabulary is curated.
 *
 * @remarks
 * Docket ships no custom-field engine on purpose — the MVP plan's first principle is that people
 * should not have to configure their way to a workflow. Labels are where a workspace names a
 * dimension the product does not model at all, which is a different job from Settings → Statuses:
 * that page reshapes a dimension Docket *does* model, within a taxonomy it holds fixed. This page
 * is where the free-form half is kept honest.
 *
 * Most labels are *not* created here; they are created inline from a picker, mid-thought, by
 * whoever is doing the work. So this page is weighted toward curation rather than creation: usage
 * counts, an explicit unused section, merge, and scope. Those are what keep a label set from
 * silently becoming a junk drawer — especially after an import arrives carrying a provider's
 * labels nobody chose.
 *
 * Sections run: groups (the closest thing to a custom field), then loose labels, then anything
 * limited to a team, then the unused. That order is "most structured first, most disposable last".
 */
import type { LabelGroupOut, LabelOut, LabelUpdate, TeamOut } from '@docket/types';
import { Button, Checkbox, Skeleton } from '@docket/ui/primitives';
import { Plus } from '@docket/ui/icons';
import { type JSX, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import { LabelEditorDialog } from '@/components/labels/label-editor-dialog';
import { LabelSettingsRow } from '@/components/labels/label-settings-row';
import {
  labelGroupsDef,
  labelsWithCountsDef,
  useCreateLabelGroup,
  useDeleteLabel,
  useDeleteLabelGroup,
  useUpdateLabel,
  useUpdateLabelGroup,
} from '@/components/labels/queries';
import { SectionHeader } from '@/components/settings/section-header';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { api } from '@/lib/api';
import { useAppParams } from '@/lib/app-location';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery } from '@/lib/query';

/** Which label the editor is open on, and which group it would be created into. */
interface EditorTarget {
  label: LabelOut | null;
  groupId: string | null;
}

/**
 * Manage the workspace's labels.
 *
 * @remarks
 * Reads the org id with `useAppParams` rather than Next's `params` promise, matching every other
 * settings page — the offline route table mounts routes with no props at all.
 */
export default function LabelsSettingsPage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();
  const { activeOrg } = useActiveOrg();
  const { canManage } = useCanManageOrg(orgId);

  // A personal workspace is an org of one with a single default team, so "limit this to a team"
  // is a question with no meaningful answer there. Org-backing is an implementation detail.
  const hideScope = activeOrg?.isPersonal ?? false;

  const labelsQ = useApiListQuery(labelsWithCountsDef(orgId));
  const groupsQ = useApiListQuery(labelGroupsDef(orgId));
  const teamsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.teams(orgId),
      () => api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }),
      'Could not load teams.',
      { enabled: !hideScope, staleTime: STALE.static },
    ),
  );

  const updateLabel = useUpdateLabel(orgId);
  const removeLabel = useDeleteLabel(orgId);
  const createGroup = useCreateLabelGroup(orgId);
  const updateGroup = useUpdateLabelGroup(orgId);
  const removeGroup = useDeleteLabelGroup(orgId);

  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [deleting, setDeleting] = useState<LabelOut | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [dissolving, setDissolving] = useState<LabelGroupOut | null>(null);

  const labels: readonly LabelOut[] = labelsQ.data?.items ?? [];
  const groups: readonly LabelGroupOut[] = groupsQ.data?.items ?? [];
  const teams: readonly TeamOut[] = teamsQ.data?.items ?? [];

  const byName = (a: LabelOut, b: LabelOut): number => a.name.localeCompare(b.name);
  const groupIds = new Set(groups.map((g) => g.id));

  // Group membership is structural, so a group always lists every member — including ones nothing
  // currently uses. Filing those under "Not used" instead would make the group look like it had
  // silently lost a member, and "nothing carries these, deleting costs nothing" is the wrong
  // advice about one arm of a single-choice dimension.
  const inGroup = (l: LabelOut): boolean => l.groupId != null && groupIds.has(l.groupId);
  const ungrouped = labels.filter((l) => !inGroup(l));

  const unused = ungrouped.filter((l) => (l.usageCount ?? 0) === 0).sort(byName);
  const used = ungrouped.filter((l) => (l.usageCount ?? 0) > 0);
  const loose = used.filter((l) => l.teamId == null).sort(byName);
  const teamScoped = used.filter((l) => l.teamId != null).sort(byName);

  const rowProps = (label: LabelOut): Parameters<typeof LabelSettingsRow>[0] => ({
    label,
    teams,
    canManage,
    hideScope,
    onEdit: () => {
      setEditing({ label, groupId: label.groupId ?? null });
    },
    onScope: (teamId) => {
      updateLabel.mutate({ id: label.id, teamId: teamId as LabelUpdate['teamId'] });
    },
    onDelete: () => {
      setDeleteError(null);
      setDeleting(label);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Labels"
        description="Your workspace's own vocabulary, for the dimensions Docket does not model. Priorities and health are Docket's opinions; statuses and labels are yours."
        action={
          canManage ? (
            <Button
              type="button"
              onClick={() => {
                setEditing({ label: null, groupId: null });
              }}
            >
              <Plus />
              New label
            </Button>
          ) : undefined
        }
      />

      {labelsQ.isPending ? (
        <Skeleton className="h-96 max-w-3xl rounded-lg" />
      ) : labelsQ.isError ? (
        <p role="status" className="text-on-surface-variant text-body-medium">
          Labels are temporarily unavailable. We&apos;ll keep checking automatically.
        </p>
      ) : labels.length === 0 ? (
        <EmptyLabels
          canManage={canManage}
          onCreate={() => {
            setEditing({ label: null, groupId: null });
          }}
        />
      ) : (
        <div className="flex max-w-3xl flex-col gap-8">
          {groups.map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              labels={labels.filter((l) => l.groupId === group.id).sort(byName)}
              canManage={canManage}
              onToggleExclusive={(exclusive) => {
                updateGroup.mutate({ id: group.id, exclusive });
              }}
              onAddLabel={() => {
                setEditing({ label: null, groupId: group.id });
              }}
              onDissolve={() => {
                setDissolving(group);
              }}
              renderRow={(label) => <LabelSettingsRow key={label.id} {...rowProps(label)} />}
            />
          ))}

          <LabelSection
            id="loose"
            title={groups.length > 0 ? 'Other labels' : 'Labels'}
            labels={loose}
            renderRow={(label) => <LabelSettingsRow key={label.id} {...rowProps(label)} />}
          />

          {!hideScope && teamScoped.length > 0 ? (
            <LabelSection
              id="team"
              title="Limited to a team"
              description="Offered only inside their own team. Useful for shorthand one team says out loud — anything you would want in a workspace-wide report should not live here."
              labels={teamScoped}
              renderRow={(label) => <LabelSettingsRow key={label.id} {...rowProps(label)} />}
            />
          ) : null}

          {unused.length > 0 ? (
            <LabelSection
              id="unused"
              title="Not used"
              description="Nothing carries these. Deleting them costs nothing."
              labels={unused}
              renderRow={(label) => <LabelSettingsRow key={label.id} {...rowProps(label)} />}
            />
          ) : null}

          {canManage ? (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  createGroup.mutate({ name: 'New group' });
                }}
                disabled={createGroup.isPending}
              >
                <Plus />
                New group
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {editing ? (
        <LabelEditorDialog
          orgId={orgId}
          label={editing.label}
          labels={labels}
          groupId={editing.groupId}
          open
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title="Delete this label?"
        description={
          deleting
            ? `“${deleting.name}” comes off ${deleting.usageCount ?? 0} ${
                (deleting.usageCount ?? 0) === 1 ? 'item' : 'items'
              }. The work itself is untouched. To keep the tagging, merge it into another label instead.`
            : ''
        }
        confirmLabel="Delete label"
        pending={removeLabel.isPending}
        error={deleteError}
        onConfirm={() => {
          if (!deleting) return;
          removeLabel.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
            },
            onError: (caught) => {
              setDeleteError(userErrorMessage(caught, 'Could not delete the label.'));
            },
          });
        }}
      />

      <ConfirmDeleteDialog
        open={dissolving !== null}
        onOpenChange={(next) => {
          if (!next) setDissolving(null);
        }}
        title="Dissolve this group?"
        description={
          dissolving
            ? `“${dissolving.name}” stops being a single choice. Its labels stay exactly where they are — they just become ordinary labels.`
            : ''
        }
        confirmLabel="Dissolve group"
        pending={removeGroup.isPending}
        error={null}
        onConfirm={() => {
          if (!dissolving) return;
          removeGroup.mutate(dissolving.id, {
            onSuccess: () => {
              setDissolving(null);
            },
          });
        }}
      />
    </div>
  );
}

/** A plain titled section of label rows. */
function LabelSection({
  id,
  title,
  description,
  labels,
  renderRow,
}: {
  id: string;
  title: string;
  description?: string;
  labels: readonly LabelOut[];
  renderRow: (label: LabelOut) => JSX.Element;
}): JSX.Element | null {
  if (labels.length === 0) return null;
  return (
    <section aria-labelledby={`labels-${id}`} className="flex flex-col gap-2">
      <h3 id={`labels-${id}`} className="text-on-surface text-label-large">
        {title}
      </h3>
      {description ? (
        <p className="text-on-surface-variant text-body-small">{description}</p>
      ) : null}
      <ul className="flex flex-col gap-1">{labels.map(renderRow)}</ul>
    </section>
  );
}

/** One label group, with its exclusivity switch. */
function GroupSection({
  group,
  labels,
  canManage,
  onToggleExclusive,
  onAddLabel,
  onDissolve,
  renderRow,
}: {
  group: LabelGroupOut;
  labels: readonly LabelOut[];
  canManage: boolean;
  onToggleExclusive: (exclusive: boolean) => void;
  onAddLabel: () => void;
  onDissolve: () => void;
  renderRow: (label: LabelOut) => JSX.Element;
}): JSX.Element {
  return (
    <section aria-labelledby={`group-${group.id}`} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h3 id={`group-${group.id}`} className="text-on-surface text-label-large">
          {group.name}
        </h3>
        {canManage ? (
          <>
            <label className="text-on-surface-variant text-label-medium ml-auto flex items-center gap-2">
              Single choice
              <Checkbox
                checked={group.exclusive}
                onChange={() => {
                  onToggleExclusive(!group.exclusive);
                }}
                aria-label={`${group.name}: single choice`}
              />
            </label>
            <Button type="button" variant="ghost" size="sm" onClick={onDissolve}>
              Dissolve
            </Button>
          </>
        ) : null}
      </div>
      <p className="text-on-surface-variant text-body-small">
        {group.exclusive
          ? 'Picking one of these releases the others — a single choice, like a status.'
          : 'These sit together, but several can apply at once.'}
      </p>
      {labels.length === 0 ? (
        <div className="bg-surface-container-low text-on-surface-variant text-body-medium flex items-center justify-between gap-3 rounded-lg px-4 py-3">
          <span>No labels in this group yet.</span>
          {canManage ? (
            <Button type="button" variant="ghost" size="sm" onClick={onAddLabel}>
              Add one
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-1">{labels.map(renderRow)}</ul>
      )}
    </section>
  );
}

/** What a workspace with no labels yet sees. */
function EmptyLabels({
  canManage,
  onCreate,
}: {
  canManage: boolean;
  onCreate: () => void;
}): JSX.Element {
  return (
    <div className="bg-surface-container-low flex max-w-3xl flex-col items-start gap-3 rounded-lg px-4 py-6">
      <p className="text-on-surface text-body-medium">No labels yet.</p>
      <p className="text-on-surface-variant text-body-small">
        You do not have to start here. Type a new name into the label picker on any task or project
        and it will be created as you go — this page is for tidying up afterwards.
      </p>
      {canManage ? (
        <Button type="button" variant="ghost" size="sm" onClick={onCreate}>
          Create one now
        </Button>
      ) : null}
    </div>
  );
}
