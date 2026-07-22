'use client';

import type { OrgOut, OrgUpdate, VocabularyPreset } from '@docket/types';
import { Input, Skeleton } from '@docket/ui/primitives';
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

/** Workspace addresses are lowercase, hyphen-separated identifiers. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
 * Build the single-field patch for an autosave commit.
 *
 * @returns The `OrgUpdate` to send, or `null` when the field value is invalid
 * and must not be persisted (the user's input stays untouched).
 */
function fieldPatch(field: keyof WorkspaceDraft, source: WorkspaceDraft): OrgUpdate | null {
  switch (field) {
    case 'name': {
      const name = source.name.trim();
      return name ? { name } : null;
    }
    case 'purpose':
      return { purpose: source.purpose.trim() || null };
    case 'slug': {
      const slug = source.slug.trim();
      return SLUG_PATTERN.test(slug) ? { slug } : null;
    }
    case 'avatar':
      return { avatar: source.avatar.trim() || null };
    case 'vocabulary':
      return { vocabulary: source.vocabulary };
  }
}

/** Whether a draft field still matches what is currently persisted. */
function fieldUnchanged(
  field: keyof WorkspaceDraft,
  source: WorkspaceDraft,
  persisted: WorkspaceDraft,
): boolean {
  switch (field) {
    case 'name':
      return source.name.trim() === persisted.name;
    case 'purpose':
      return source.purpose.trim() === persisted.purpose;
    case 'slug':
      return source.slug.trim() === persisted.slug;
    case 'avatar':
      return source.avatar.trim() === persisted.avatar;
    case 'vocabulary':
      return source.vocabulary === persisted.vocabulary;
  }
}

/**
 * Edit every safe, user-facing workspace identity attribute.
 *
 * @remarks
 * Editing autosaves: text fields persist on blur, and the terminology select
 * and logo picker persist immediately on change. Each commit fires only for the
 * field that actually changed from what is persisted, never on mount and never
 * for an unchanged value. Status is surfaced inline; there is no Save button.
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
    // Do not replace the draft here: the live query reconciles persisted state,
    // which preserves any other field the user is still editing.
    onSuccess: () => {
      setSaved(true);
    },
  });

  const current = workspaceQ.data ? draftFromWorkspace(workspaceQ.data) : null;
  const canEdit = !permissionLoading && canManage;
  const readOnly = !canEdit;

  /** Update a draft field as the user types (no persistence yet). */
  function update<K extends keyof WorkspaceDraft>(keyName: K, value: WorkspaceDraft[K]): void {
    setDraft((previous) => (previous ? { ...previous, [keyName]: value } : previous));
    setEditing(true);
    setSaved(false);
  }

  /** Autosave a single field when it changed from what is persisted. */
  function commitField(field: keyof WorkspaceDraft, source: WorkspaceDraft): void {
    if (!canEdit || !current) return;
    if (fieldUnchanged(field, source, current)) return;
    const patch = fieldPatch(field, source);
    if (!patch) return;
    save.mutate(patch);
  }

  /** Change a field and persist it immediately (selects, logo). */
  function updateAndCommit<K extends keyof WorkspaceDraft>(
    keyName: K,
    value: WorkspaceDraft[K],
  ): void {
    if (!draft) return;
    const next = { ...draft, [keyName]: value };
    setDraft(next);
    setEditing(true);
    setSaved(false);
    commitField(keyName, next);
  }

  const nameInvalid = draft !== null && draft.name.trim() === '';
  const slugInvalid = draft !== null && !SLUG_PATTERN.test(draft.slug.trim());

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
                onBlur={() => {
                  commitField('name', draft);
                }}
              />
              {nameInvalid ? (
                <span className="text-destructive text-xs font-normal">
                  Workspace name is required.
                </span>
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
                onBlur={() => {
                  commitField('purpose', draft);
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
                onBlur={() => {
                  commitField('slug', draft);
                }}
              />
              <span
                id="workspace-slug-help"
                className="text-on-surface-variant text-xs font-normal"
              >
                Used as the stable identifier for links and integrations:{' '}
                {draft.slug || 'workspace'}
              </span>
              {slugInvalid ? (
                <span className="text-destructive text-xs font-normal">
                  Use lowercase letters and numbers, separated by hyphens.
                </span>
              ) : null}
            </label>

            <label className="text-on-surface flex flex-col gap-1.5 text-sm font-medium">
              Terminology
              <select
                value={draft.vocabulary}
                disabled={readOnly}
                onChange={(event) => {
                  updateAndCommit('vocabulary', event.target.value as VocabularyPreset);
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
                  updateAndCommit('avatar', value);
                }}
              />
            </div>
          </div>

          {save.error ? (
            <p role="alert" className="text-destructive text-sm">
              {userErrorMessage(save.error, 'Could not save workspace settings.')}
            </p>
          ) : (
            <p role="status" aria-live="polite" className="text-on-surface-variant h-4 text-xs">
              {save.isPending ? 'Saving…' : saved ? 'Saved' : ''}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
