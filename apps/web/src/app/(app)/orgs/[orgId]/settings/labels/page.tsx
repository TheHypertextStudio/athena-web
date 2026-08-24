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
import { EmptyState } from '@docket/ui/components';
import { Plus, Tag } from '@docket/ui/icons';
import { type JSX, useState } from 'react';

import { LoadFailure } from '@/components/settings/load-failure';
import { firstWriteError, WriteError } from '@/components/settings/write-error';
import { useActiveOrg } from '@/components/active-org';
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
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
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { api } from '@/lib/api';
import { useTypedRoute } from '@/lib/app-location';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery } from '@/lib/query';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';
import { SettingRow } from '@/components/settings/setting-row';
import { SettingsGroup } from '@/components/settings/settings-group';

/** Which label the editor is open on, and which group it would be created into. */
interface EditorTarget {
  label: LabelOut | null;
  groupId: string | null;
}

/**
 * Manage the workspace's labels.
 *
 * @remarks
 * Reads the org id from the generated typed route rather than Next's `params` promise, matching every other
 * settings page — the offline route table mounts routes with no props at all.
 */
export default function LabelsSettingsPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/settings/labels');
  const { activeOrg } = useActiveOrg();
  // Creating a label is a `contribute` write server-side; restructuring the label set (groups,
  // scope, delete) is `manage`. Gating both on `canManage` hid the New label button from every
  // member the API would have accepted.
  const { canManage, canContribute } = useCanManageOrg(orgId);

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

  // Six writes with no failure surface: a refused rename or reorder simply reverted on the next
  // render, which reads as the product discarding your edit for no reason.
  const writeError = firstWriteError([
    [updateLabel, 'Could not save that label.'],
    [removeLabel, 'Could not delete that label.'],
    [createGroup, 'Could not create that group.'],
    [updateGroup, 'Could not save that group.'],
    [removeGroup, 'Could not dissolve that group.'],
  ]);

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
    <SettingsSectionPage
      title="Labels"
      description="Your workspace's own tags, for anything you want to track that Docket has no field for."
      action={
        canContribute ? (
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
    >
      {writeError ? <WriteError message={writeError} /> : null}
      {labelsQ.isPending ? (
        <Skeleton className="h-96 max-w-3xl rounded-xl" />
      ) : labelsQ.isError ? (
        <LoadFailure message={userErrorMessage(labelsQ.error, 'Could not load labels.')} retrying />
      ) : labels.length === 0 ? (
        <EmptyLabels
          canManage={canContribute}
          onCreate={() => {
            setEditing({ label: null, groupId: null });
          }}
        />
      ) : (
        <div className="flex max-w-3xl flex-col gap-4">
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
            title={groups.length > 0 ? 'Other labels' : 'Labels'}
            labels={loose}
            renderRow={(label) => <LabelSettingsRow key={label.id} {...rowProps(label)} />}
          />

          {!hideScope && teamScoped.length > 0 ? (
            <LabelSection
              title="Limited to a team"
              description="Offered only inside their own team."
              labels={teamScoped}
              renderRow={(label) => <LabelSettingsRow key={label.id} {...rowProps(label)} />}
            />
          ) : null}

          {unused.length > 0 ? (
            <LabelSection
              title="Not used"
              description="Nothing uses these yet."
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

      <ConfirmDestructiveDialog
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

      <ConfirmDestructiveDialog
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
    </SettingsSectionPage>
  );
}

/** A plain titled section of label rows. */
function LabelSection({
  title,
  description,
  labels,
  renderRow,
}: {
  title: string;
  description?: string;
  labels: readonly LabelOut[];
  renderRow: (label: LabelOut) => JSX.Element;
}): JSX.Element | null {
  if (labels.length === 0) return null;
  return (
    <SettingsGroup title={title} {...(description ? { description } : {})} body="rows">
      <ul>{labels.map(renderRow)}</ul>
    </SettingsGroup>
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
    <SettingsGroup
      title={group.name}
      description={
        group.exclusive
          ? 'Picking one of these releases the others, like a status.'
          : 'These sit together, and several can apply at once.'
      }
      body="rows"
      action={
        canManage ? (
          <>
            <label className="text-on-surface-variant text-label-medium flex items-center gap-2">
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
        ) : undefined
      }
    >
      {labels.length === 0 ? (
        <SettingRow
          label="No labels in this group yet."
          {...(canManage
            ? {
                trailing: (
                  <Button type="button" variant="ghost" size="sm" onClick={onAddLabel}>
                    Add one
                  </Button>
                ),
              }
            : {})}
        />
      ) : (
        <ul>{labels.map(renderRow)}</ul>
      )}
    </SettingsGroup>
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
    <SettingsGroup>
      <EmptyState
        icon={Tag}
        title="No labels yet"
        body="Type a new name into the label picker on any task or project and it will be created as you go. This page is for tidying up afterwards."
        frame="none"
        {...(canManage ? { cta: { label: 'Create one now', onClick: onCreate } } : {})}
      />
    </SettingsGroup>
  );
}
