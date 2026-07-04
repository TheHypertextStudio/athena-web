/**
 * Data hook for a task's attachments — the general attachment model on the client.
 *
 * @remarks
 * Reads `/tasks/:id/attachments` and exposes add-url / upload-file / remove mutations, all
 * through the shared typed query layer so the list auto-refetches after a write. Email
 * attachments are read-only here (created by accepting an Athena suggestion); the client-authored
 * kinds are a pasted `url` and an uploaded `file` (multipart to the dedicated upload route, whose
 * bytes are then fetched via {@link TaskAttachmentsData.downloadUrl}). See
 * `docs/engineering/specs/email-to-task.md` §9.
 */
import type { AttachmentOut } from '@docket/types';
import type { QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from './api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from './query';

/** The stable React Query key for a task's attachment list. */
export function attachmentsKey(orgId: string, taskId: string): QueryKey {
  return [...queryKeys.task(orgId, taskId), 'attachments'];
}

/** All attachment data + mutation callbacks for one task. */
export interface TaskAttachmentsData {
  /** The task's attachments, oldest-first. */
  attachments: readonly AttachmentOut[];
  /** Whether the list's first load is in flight. */
  isPending: boolean;
  /** Whether a file upload is currently in flight. */
  isUploading: boolean;
  /** Attach a pasted link. */
  addUrl: (input: { url: string; title: string }) => Promise<void>;
  /** Upload a file and attach it (multipart). */
  addFile: (input: { file: File; title?: string }) => Promise<void>;
  /** Remove an attachment (deletes its blob too, for `file` kinds). */
  remove: (attachmentId: string) => Promise<void>;
  /** The same-origin URL for downloading a `file` attachment's bytes (for an `<a href download>`). */
  downloadUrl: (attachmentId: string) => string;
  /** The most recent add/upload/remove error message, or `null`. */
  actionError: string | null;
}

/**
 * Fetch a task's attachments and expose add-url / remove writes.
 *
 * @param orgId - The active organization id.
 * @param taskId - The task whose attachments are shown.
 */
export function useTaskAttachments(orgId: string, taskId: string): TaskAttachmentsData {
  const key = useMemo<QueryKey>(() => attachmentsKey(orgId, taskId), [orgId, taskId]);

  const listQ = useApiQuery(
    apiQueryOptions(
      key,
      () => api.v1.orgs[':orgId'].tasks[':id'].attachments.$get({ param: { orgId, id: taskId } }),
      'Could not load attachments.',
    ),
  );

  const addUrlM = useApiMutation({
    mutationFn: (input: { url: string; title: string }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].attachments.$post({
            param: { orgId, id: taskId },
            json: { kind: 'url', title: input.title, url: input.url },
          }),
        'Could not attach the link.',
      ),
    invalidateKeys: [key],
  });

  const addFileM = useApiMutation({
    // `input` already matches the multipart form shape (`{ file, title? }`), so it's passed straight
    // through — a `title?`-present/absent ternary here widens to a union the RPC form type rejects.
    mutationFn: (input: { file: File; title?: string }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].attachments.upload.$post({
            param: { orgId, id: taskId },
            form: input,
          }),
        'Could not upload the file.',
      ),
    invalidateKeys: [key],
  });

  const removeM = useApiMutation({
    mutationFn: (attachmentId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].attachments[':attachmentId'].$delete({
            param: { orgId, id: taskId, attachmentId },
          }),
        'Could not remove the attachment.',
      ),
    invalidateKeys: [key],
  });

  return {
    attachments: listQ.data?.items ?? [],
    isPending: listQ.isPending,
    isUploading: addFileM.isPending,
    addUrl: async (input) => void (await addUrlM.mutateAsync(input)),
    addFile: async (input) => void (await addFileM.mutateAsync(input)),
    remove: async (attachmentId) => void (await removeM.mutateAsync(attachmentId)),
    downloadUrl: (attachmentId) =>
      `/v1/orgs/${orgId}/tasks/${taskId}/attachments/${attachmentId}/download`,
    actionError:
      addUrlM.error?.message ?? addFileM.error?.message ?? removeM.error?.message ?? null,
  };
}
