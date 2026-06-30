/**
 * Data hook for a task's attachments — the general attachment model on the client.
 *
 * @remarks
 * Reads `/tasks/:id/attachments` and exposes add-url / remove mutations, all through the
 * shared typed query layer so the list auto-refetches after a write. Email attachments are
 * read-only here (created by accepting an Athena suggestion); the only client-authored kind is
 * a pasted `url`. See `docs/engineering/specs/email-to-task.md` §9.
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
  attachments: readonly AttachmentOut[];
  isPending: boolean;
  addUrl: (input: { url: string; title: string }) => Promise<void>;
  remove: (attachmentId: string) => Promise<void>;
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
    addUrl: async (input) => void (await addUrlM.mutateAsync(input)),
    remove: async (attachmentId) => void (await removeM.mutateAsync(attachmentId)),
    actionError: addUrlM.error?.message ?? removeM.error?.message ?? null,
  };
}
