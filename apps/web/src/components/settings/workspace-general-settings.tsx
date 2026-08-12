'use client';

import { PublicSlug, type OrgOut, type OrgUpdate, type VocabularyPreset } from '@docket/types';
import { env } from '@docket/env/web';
import { Input, Select, Skeleton } from '@docket/ui/primitives';
import { useEffect, useState, type JSX } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useLiveApiQuery } from '@/lib/query';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';

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

/**
 * Edit every safe, user-facing workspace identity attribute.
 *
 * @remarks
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
    value: draft?.slug.trim() ?? '',
    baseline: current?.slug,
    ready: canEdit && current !== null,
    save: (slug) => {
      if (PublicSlug.safeParse(slug).success) save.mutate({ slug });
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
  const slugInvalid = draft !== null && !PublicSlug.safeParse(draft.slug.trim()).success;
  const briefHost = env.NEXT_PUBLIC_BRIEF_HOST;

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
        /* placeholder: this workspace's saved name, slug and work-vocabulary overrides — the values
           the form's fields are *for*. The section heading and description render above it. */
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
              {nameInvalid ? (
                <span className="text-error text-xs font-normal">Workspace name is required.</span>
              ) : null}
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
                maxLength={64}
                aria-describedby="workspace-slug-help"
                {...(briefHost === undefined ? {} : { prefix: `${briefHost}/` })}
                onChange={(event) => {
                  update('slug', event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
                }}
              />
              <span
                id="workspace-slug-help"
                className="text-on-surface-variant text-xs font-normal"
              >
                {briefHost === undefined
                  ? "Your workspace's one identifier — lowercase letters, numbers, and hyphens."
                  : 'Also where your published pages answer by default, unless you set up a custom domain in Settings → Publishing.'}
              </span>
              {slugInvalid ? (
                <span className="text-error text-xs font-normal">
                  Use lowercase letters and numbers, separated by hyphens, and not a reserved name.
                </span>
              ) : null}
            </label>

            <label className="text-on-surface flex flex-col gap-1.5 text-sm font-medium">
              Terminology
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
            </label>

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
            <p role="alert" className="text-error text-sm">
              {userErrorMessage(save.error, 'Could not save workspace settings.')}
            </p>
          ) : (
            <p role="status" aria-live="polite" className="text-on-surface-variant h-4 text-xs">
              {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : ''}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
