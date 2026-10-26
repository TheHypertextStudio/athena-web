'use client';

import { useState } from 'react';
import { transferFile } from './resumable-upload';
import { uploadControl } from './upload-control';
import type { AttachmentOut, WorkResourceSubjectType } from '@docket/work/attachment-contract';
import { api } from './api';
import { fetchAllCursorPages } from './fetch-all-cursor-pages';
import { userErrorMessage } from './problem';
import { apiQueryOptions, unwrap, useApiMutation, useApiQuery } from './query';

/** Resource state and person-facing actions for one work item. */
export interface WorkResourcesData {
  readonly resources: readonly AttachmentOut[];
  readonly loading: boolean;
  readonly pending: boolean;
  readonly uploading: boolean;
  readonly uploadProgress: number;
  readonly error: string | null;
  readonly loadFailure: unknown;
  readonly add: (input: { title: string; url: string }) => void;
  readonly upload: (file: File) => void;
  readonly remove: (id: string) => void;
  readonly downloadHref: (id: string) => string;
  readonly retry: () => void;
}

/** Load and manage one work item's resources through the typed application query layer. */
export function useWorkResources(
  orgId: string,
  subjectType: WorkResourceSubjectType,
  subjectId: string,
): WorkResourcesData {
  const [uploadProgress, setUploadProgress] = useState(0);
  const param = { orgId, subjectType, subjectId };
  const route = api.v1.orgs[':orgId']['work-resources'][':subjectType'][':subjectId'];
  const key = ['work-resources', orgId, subjectType, subjectId] as const;
  const list = useApiQuery(
    apiQueryOptions(
      key,
      () =>
        fetchAllCursorPages((cursor) =>
          route.$get({
            param,
            query: { limit: '100', ...(cursor ? { cursor } : {}) },
          }),
        ),
      'Could not load resources.',
    ),
  );
  const add = useApiMutation({
    mutationFn: (json: { title: string; url: string; requestId: string }) =>
      unwrap(() => route.$post({ param, json }), 'Could not add the resource.'),
    invalidateKeys: [key],
  });
  const upload = useApiMutation({
    mutationFn: ({ file, requestId }: { file: File; requestId: string }) => {
      setUploadProgress(0);
      return transferFile({
        file,
        requestId,
        destination: { kind: 'work', subjectType, subjectId },
        control: uploadControl(orgId),
        onProgress: setUploadProgress,
      });
    },
    invalidateKeys: [key],
  });
  const remove = useApiMutation({
    mutationFn: (attachmentId: string) =>
      unwrap(
        () => route[':attachmentId'].$delete({ param: { ...param, attachmentId } }),
        'Could not remove the resource.',
      ),
    invalidateKeys: [key],
  });
  // Writes use the shared mutation notice, including retry of the original variables.
  // A read failure belongs in its resource region; do not show the same write error twice.
  const error = list.error;
  return {
    resources: list.data?.items ?? [],
    loading: list.isPending,
    pending: add.isPending || upload.isPending || remove.isPending,
    uploading: upload.isPending,
    uploadProgress,
    error: error ? userErrorMessage(error, 'Could not load resources.') : null,
    loadFailure: list.error,
    add: (input: { title: string; url: string }): void => {
      add.mutate({ ...input, requestId: crypto.randomUUID() });
    },
    upload: (file: File): void => {
      upload.mutate({ file, requestId: crypto.randomUUID() });
    },
    remove: (id: string): void => {
      remove.mutate(id);
    },
    retry: (): void => {
      void list.refetch();
    },
    downloadHref: (attachmentId: string): string =>
      `/v1/orgs/${encodeURIComponent(orgId)}/work-resources/${subjectType}/${encodeURIComponent(subjectId)}/${encodeURIComponent(attachmentId)}/download`,
  };
}
