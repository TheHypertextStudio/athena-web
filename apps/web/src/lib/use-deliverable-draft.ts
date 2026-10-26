'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DeliverableDraftOut, DeliverableOut } from '@docket/work/attachment-contract';
import { api } from './api';
import { transferFile, type FileTransfer } from './resumable-upload';
import { uploadControl } from './upload-control';
import { ApiRequestError } from './query-core';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from './query';
import {
  cancelUpload,
  removePendingUpload,
  retryUpload,
  selectUploads,
} from './deliverable-upload-queue';
import type { PendingDeliverableUpload, UploadQueueContext } from './deliverable-upload-queue';
export type { PendingDeliverableUpload } from './deliverable-upload-queue';

/** Inputs for private uploads shared by comment and update composers. */
export interface DeliverableDraftOptions {
  readonly orgId: string;
  readonly files: readonly DeliverableOut[];
  readonly disabled: boolean;
  readonly onChange: (files: DeliverableOut[]) => void;
  readonly onBusy: (busy: boolean) => void;
}

/** Current private uploads and operations exposed to a post composer. */
export interface DeliverableDraftState {
  readonly busy: boolean;
  readonly error: string;
  readonly pending: readonly PendingDeliverableUpload[];
  readonly select: (files: readonly File[]) => Promise<void>;
  readonly retry: (key: string) => Promise<void>;
  readonly cancel: (key: string) => void;
  readonly removePending: (key: string) => void;
  readonly remove: (id: string) => Promise<void>;
}

/** Upload, recover, retry, and discard private deliverables with per-file byte progress.
 * @param options - The organization and composer state that own these files.
 * @returns Pending and completed file state with its upload, retry, cancel, and discard actions.
 */
export function useDeliverableDraft({
  orgId,
  files,
  disabled,
  onChange,
  onBusy,
}: DeliverableDraftOptions): DeliverableDraftState {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingDeliverableUpload[]>([]);
  const [error, setError] = useState('');
  const controllers = useRef(new Map<string, AbortController>());
  const sessions = useRef(new Map<string, string>());
  const transfer = useApiMutation({
    mutationFn: (input: Omit<FileTransfer, 'control'>) =>
      transferFile({ ...input, control: uploadControl(orgId) }),
    failure: 'silent',
  });
  const retire = useApiMutation({
    mutationFn: (id: string) => uploadControl(orgId).cancel(id),
    failure: 'silent',
  });
  const uploadStates = useRef(new Map<string, PendingDeliverableUpload['state']>());
  const filesRef = useRef<DeliverableOut[]>([...files]);
  const recoveredFor = useRef<string | null>(null);
  filesRef.current = [...files];
  const drafts = useApiQuery(
    apiQueryOptions(
      queryKeys.deliverableDrafts(orgId),
      () => api.v1.orgs[':orgId'].deliverables.drafts.$get({ param: { orgId } }),
      'Could not recover your uploaded files.',
    ),
  );
  useEffect(() => {
    if (!drafts.data || recoveredFor.current === orgId) return;
    recoveredFor.current = orgId;
    const known = new Set(filesRef.current.map((file) => file.id));
    const recovered = (drafts.data.items as DeliverableDraftOut[]).filter(
      (file) => !known.has(file.id),
    );
    if (recovered.length > 0) onChange([...filesRef.current, ...recovered]);
  }, [drafts.data, onChange, orgId]);

  const isBusy = pending.some((item) => item.state === 'uploading');
  useEffect(() => {
    onBusy(isBusy);
  }, [isBusy, onBusy]);

  const remove = useDiscardDraft(orgId, filesRef, onChange, setError);

  const queue: UploadQueueContext = {
    orgId,
    disabled,
    fileCount: files.length,
    pending,
    states: uploadStates.current,
    controllers: controllers.current,
    sessions: sessions.current,
    transfer: transfer.mutateAsync,
    retire: retire.mutateAsync,
    setPending,
    setError,
    onUploaded(uploaded) {
      filesRef.current = [...filesRef.current, uploaded];
      onChange(filesRef.current);
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliverableDrafts(orgId) });
    },
  };
  return {
    busy: isBusy,
    error,
    pending,
    select: (selected) => selectUploads(queue, selected),
    retry: (key) => retryUpload(queue, key),
    cancel: (key) => {
      cancelUpload(queue, key);
    },
    removePending: (key) => {
      removePendingUpload(queue, key);
    },
    remove,
  };
}

function useDiscardDraft(
  orgId: string,
  filesRef: RefObject<DeliverableOut[]>,
  onChange: (files: DeliverableOut[]) => void,
  setError: (error: string) => void,
): (id: string) => Promise<void> {
  const discard = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.orgs[':orgId'].deliverables[':id'].$delete({ param: { orgId, id } }),
        'Could not remove that file.',
      ),
    failure: 'silent',
    invalidateKeys: [queryKeys.deliverableDrafts(orgId)],
  });
  async function remove(id: string): Promise<void> {
    setError('');
    try {
      await discard.mutateAsync(id);
    } catch (caught) {
      if (!(caught instanceof ApiRequestError && caught.status === 404)) {
        setError('Could not remove that file. Try again.');
        return;
      }
    }
    filesRef.current = filesRef.current.filter((file) => file.id !== id);
    onChange([...filesRef.current]);
  }

  return remove;
}
