'use client';

import type { OrgOut, OrgUpdate } from '../../lib/contracts/organization';
import { WriteError } from './write-error';
import type { VocabularyPreset } from '@docket/work/vocabulary';
import { Field, Input, Select, Skeleton, Textarea } from '@docket/ui/primitives';
import { useEffect, useState, type JSX } from 'react';

import { LoadFailure } from './load-failure';
import { SettingsGroup } from './settings-group';
import { SETTINGS_NODES } from './settings-capabilities';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useLiveApiQuery } from '@/lib/query';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';

import { SettingsImagePicker } from './settings-image-picker';
import { useCanManageOrg } from './use-can-manage-org';
import { SettingsSectionPage } from './settings-section-page';

/** Props for the workspace General settings editor. */
export interface WorkspaceGeneralSettingsProps {
  /** Workspace whose user-facing identity is being edited. */
  readonly orgId: string;
}

/** Editable draft derived from the workspace response. */
interface WorkspaceDraft {
  readonly name: string;
  readonly purpose: string;
  readonly avatar: string;
  readonly vocabulary: VocabularyPreset;
}

/** Convert a workspace response into controlled form values. */
function draftFromWorkspace(workspace: OrgOut): WorkspaceDraft {
  return {
    name: workspace.name,
    purpose: workspace.purpose ?? '',
    avatar: workspace.avatar ?? '',
    vocabulary: workspace.vocabulary.preset,
  };
}

/**
 * Edit every safe, user-facing workspace identity attribute.
 *
 * @remarks
 * Identity here means how the workspace *appears*: its name, what it is for, how its work is
 * named, and its logo. Its public web address is not appearance — it is an address, and it lives
 * with the other addresses the workspace answers on, in Settings → Publishing.
 *
 * Each field autosaves independently through {@link useDebouncedAutosave} — the shared seam
 * behind every autosaving field in the app, rather than a page-local reimplementation of it (this
 * page used to carry its own ~90-line `fieldPatch`/`fieldUnchanged`/`commitField` dirty-check,
 * doing by hand exactly what that hook already does). Text fields persist on a quiet debounce; the
 * terminology select and logo picker persist immediately on change. `editing` is the one piece of
 * genuinely page-specific logic left: this page polls the workspace on a 15s live query, and
 * without it a poll landing mid-edit would overwrite whatever the caller hasn't finished typing.
 */
export function WorkspaceGeneralSettings({ orgId }: WorkspaceGeneralSettingsProps): JSX.Element {
  const key = queryKeys.organization(orgId);
  const workspaceQ = useLiveApiQuery(
    apiQueryOptions(
      key,
      () => api.v1.orgs[':orgId'].$get({ param: { orgId } }),
      'Could not load workspace settings.',
    ),
    15_000,
  );
  const { canManage, loading: permissionLoading } = useCanManageOrg(orgId);
  const [draft, setDraft] = useState<WorkspaceDraft | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!workspaceQ.data) return;
    const next = draftFromWorkspace(workspaceQ.data);
    if (editing) {
      if (draft !== null && JSON.stringify(draft) === JSON.stringify(next)) setEditing(false);
      return;
    }
    if (draft === null || JSON.stringify(draft) !== JSON.stringify(next)) setDraft(next);
  }, [draft, editing, workspaceQ.data]);

  const save = useApiMutation<OrgOut, OrgUpdate>({
    mutationFn: (json) =>
      unwrap(
        () => api.v1.orgs[':orgId'].$patch({ param: { orgId }, json }),
        'Could not save workspace settings.',
      ),
    invalidateKeys: [key, queryKeys.orgs()],
  });

  const current = workspaceQ.data ? draftFromWorkspace(workspaceQ.data) : null;
  const canEdit = !permissionLoading && canManage;
  const readOnly = !canEdit;

  /** Update a draft field as the user types (no persistence yet). */
  function update<K extends keyof WorkspaceDraft>(keyName: K, value: WorkspaceDraft[K]): void {
    setDraft((previous) => (previous ? { ...previous, [keyName]: value } : previous));
    setEditing(true);
  }

  useDebouncedAutosave({
    value: draft?.name.trim() ?? '',
    baseline: current?.name,
    ready: canEdit && current !== null,
    save: (name) => {
      if (name) save.mutate({ name });
    },
  });
  useDebouncedAutosave({
    value: draft?.purpose.trim() ?? '',
    baseline: current?.purpose,
    ready: canEdit && current !== null,
    save: (purpose) => {
      save.mutate({ purpose: purpose || null });
    },
  });
  useDebouncedAutosave({
    value: draft?.vocabulary,
    baseline: current?.vocabulary,
    ready: canEdit && current !== null,
    delayMs: 0,
    save: (vocabulary) => {
      if (vocabulary) save.mutate({ vocabulary });
    },
  });

  const nameInvalid = draft !== null && draft.name.trim() === '';

  return (
    <SettingsSectionPage
      title="General"
      description="Edit how this workspace appears and how its work is named."
    >
      {workspaceQ.isError ? (
        <LoadFailure
          message={userErrorMessage(workspaceQ.error, 'Could not load workspace settings.')}
          retrying
        />
      ) : workspaceQ.isPending || draft === null ? (
        /* placeholder: this workspace's saved name, purpose and work-vocabulary overrides — the values
           the form's fields are *for*. The section heading and description render above it. */
        <Skeleton className="h-[34rem] rounded-xl" />
      ) : (
        <SettingsGroup
          capability={SETTINGS_NODES.workspaceGeneral}
          {...(!permissionLoading && !canManage
            ? { description: 'Only workspace owners and admins can change this.' }
            : {})}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Workspace name" className="sm:col-span-2">
              <Input
                value={draft.name}
                disabled={readOnly}
                maxLength={120}
                onChange={(event) => {
                  update('name', event.target.value);
                }}
              />
              {nameInvalid ? (
                <span className="text-error text-body-small">Workspace name is required.</span>
              ) : null}
            </Field>

            <Field label="Purpose" className="sm:col-span-2">
              <Textarea
                value={draft.purpose}
                disabled={readOnly}
                maxLength={500}
                rows={3}
                placeholder="What is this workspace responsible for?"
                onChange={(event) => {
                  update('purpose', event.target.value);
                }}
                className="w-full resize-y"
              />
            </Field>

            <Field label="Terminology">
              <Select
                value={draft.vocabulary}
                disabled={readOnly}
                onChange={(event) => {
                  update('vocabulary', event.target.value as VocabularyPreset);
                }}
              >
                <option value="startup">Product and startup</option>
                <option value="nonprofit">Nonprofit and programs</option>
                <option value="agency">Agency and client work</option>
              </Select>
            </Field>

            <div className="sm:col-span-2">
              <SettingsImagePicker
                label="Workspace logo"
                value={draft.avatar}
                fallback={(draft.name.trim()[0] ?? 'W').toUpperCase()}
                disabled={readOnly}
                onChange={(value) => {
                  update('avatar', value);
                  if (canEdit && value.trim() !== (current?.avatar ?? '')) {
                    save.mutate({ avatar: value.trim() || null });
                  }
                }}
              />
            </div>
          </div>

          {save.error ? (
            <WriteError
              message={userErrorMessage(save.error, 'Could not save workspace settings.')}
            />
          ) : (
            <p
              role="status"
              aria-live="polite"
              className="text-on-surface-variant text-body-small h-4"
            >
              {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : ''}
            </p>
          )}
        </SettingsGroup>
      )}
    </SettingsSectionPage>
  );
}
