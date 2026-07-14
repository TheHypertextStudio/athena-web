'use client';

import type { OrgOut, OrgUpdate, VocabularyPreset } from '@docket/types';
import { Button, Input, Skeleton } from '@docket/ui/primitives';
import { useEffect, useState, type JSX } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useLiveApiQuery } from '@/lib/query';

import { SectionHeader } from './section-header';
import { SettingsImagePicker } from './settings-image-picker';
import { useCanManageOrg } from './use-can-manage-org';

/** Props for the workspace General settings editor. */
export interface WorkspaceGeneralSettingsProps {
  /** Workspace whose user-facing identity is being edited. */
  readonly orgId: string;
}

/** Editable draft derived from the workspace response. */
interface WorkspaceDraft {
  readonly name: string;
  readonly purpose: string;
  readonly slug: string;
  readonly avatar: string;
  readonly vocabulary: VocabularyPreset;
}

/** Convert a workspace response into controlled form values. */
function draftFromWorkspace(workspace: OrgOut): WorkspaceDraft {
  return {
    name: workspace.name,
    purpose: workspace.purpose ?? '',
    slug: workspace.slug,
    avatar: workspace.avatar ?? '',
    vocabulary: workspace.vocabulary.preset,
  };
}

/** Edit every safe, user-facing workspace identity attribute. */
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
  const [saved, setSaved] = useState(false);

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
    onSuccess: (workspace) => {
      setDraft(draftFromWorkspace(workspace));
      setSaved(true);
    },
  });

  const current = workspaceQ.data ? draftFromWorkspace(workspaceQ.data) : null;
  const changed =
    draft !== null && current !== null && JSON.stringify(draft) !== JSON.stringify(current);
  const valid = Boolean(draft?.name.trim() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug.trim()));
  const readOnly = permissionLoading || !canManage || save.isPending;

  function update<K extends keyof WorkspaceDraft>(keyName: K, value: WorkspaceDraft[K]): void {
    setDraft((previous) => (previous ? { ...previous, [keyName]: value } : previous));
    setEditing(true);
    setSaved(false);
  }

  function submit(): void {
    if (!draft || !current || !valid || !changed || readOnly) return;
    save.mutate({
      ...(draft.name.trim() !== current.name ? { name: draft.name.trim() } : {}),
      ...(draft.purpose.trim() !== current.purpose
        ? { purpose: draft.purpose.trim() || null }
        : {}),
      ...(draft.slug.trim() !== current.slug ? { slug: draft.slug.trim() } : {}),
      ...(draft.avatar.trim() !== current.avatar ? { avatar: draft.avatar.trim() || null } : {}),
      ...(draft.vocabulary !== current.vocabulary ? { vocabulary: draft.vocabulary } : {}),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="General"
        description="Edit how this workspace appears and how its work is named."
      />

      {workspaceQ.isError ? (
        <p role="status" className="text-on-surface-variant text-sm">
          Workspace settings are temporarily unavailable. We&apos;ll keep checking automatically.
        </p>
      ) : workspaceQ.isPending || draft === null ? (
        <Skeleton className="h-[34rem] max-w-2xl rounded-lg" />
      ) : (
        <section className="border-outline-variant flex max-w-2xl flex-col gap-6 rounded-lg border p-5">
          {!permissionLoading && !canManage ? (
            <p className="bg-surface-container text-on-surface-variant rounded-md px-3 py-2 text-sm">
              Only workspace owners and admins can change these details.
            </p>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="text-on-surface flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              Workspace name
              <Input
                value={draft.name}
                disabled={readOnly}
                maxLength={120}
                onChange={(event) => {
                  update('name', event.target.value);
                }}
              />
            </label>

            <label className="text-on-surface flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              Purpose
              <textarea
                value={draft.purpose}
                disabled={readOnly}
                maxLength={500}
                rows={3}
                placeholder="What is this workspace responsible for?"
                onChange={(event) => {
                  update('purpose', event.target.value);
                }}
                className="border-outline-variant bg-surface text-on-surface placeholder:text-on-surface-variant focus-visible:ring-ring w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <label className="text-on-surface flex flex-col gap-1.5 text-sm font-medium">
              Workspace address
              <Input
                value={draft.slug}
                disabled={readOnly}
                maxLength={80}
                aria-describedby="workspace-slug-help"
                onChange={(event) => {
                  update('slug', event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
                }}
              />
              <span
                id="workspace-slug-help"
                className="text-on-surface-variant text-xs font-normal"
              >
                Used as the stable identifier for links and integrations:{' '}
                {draft.slug || 'workspace'}
              </span>
            </label>

            <label className="text-on-surface flex flex-col gap-1.5 text-sm font-medium">
              Terminology
              <select
                value={draft.vocabulary}
                disabled={readOnly}
                onChange={(event) => {
                  update('vocabulary', event.target.value as VocabularyPreset);
                }}
                className="border-outline-variant bg-surface text-on-surface focus-visible:ring-ring h-10 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="startup">Product and startup</option>
                <option value="nonprofit">Nonprofit and programs</option>
                <option value="agency">Agency and client work</option>
              </select>
            </label>

            <div className="sm:col-span-2">
              <SettingsImagePicker
                label="Workspace logo"
                value={draft.avatar}
                fallback={(draft.name.trim()[0] ?? 'W').toUpperCase()}
                disabled={readOnly}
                onChange={(value) => {
                  update('avatar', value);
                }}
              />
            </div>
          </div>

          {save.error ? (
            <p role="alert" className="text-destructive text-sm">
              {userErrorMessage(save.error, 'Could not save workspace settings.')}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              type="button"
              disabled={readOnly || saved || !changed || !valid}
              onClick={submit}
            >
              {save.isPending ? 'Saving…' : 'Save workspace'}
            </Button>
            {saved ? (
              <span className="text-on-surface-variant text-xs" role="status">
                Workspace saved.
              </span>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
