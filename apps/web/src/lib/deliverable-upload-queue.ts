import type { Dispatch, SetStateAction } from 'react';
import type { DeliverableOut } from '@docket/work/attachment-contract';
import { MAX_UPLOAD_BYTES } from '@docket/work/attachment-contract';
import type { FileTransfer } from './resumable-upload';

/** One browser-local upload that can be retried or cancelled before it becomes a draft. */
export interface PendingDeliverableUpload {
  readonly key: string;
  readonly file: File;
  readonly state: 'queued' | 'uploading' | 'failed' | 'cancelled';
  readonly progress: number;
}

/** Render configuration and live state shared by sequential file operations. */
export interface UploadQueueContext {
  readonly orgId: string;
  readonly disabled: boolean;
  readonly fileCount: number;
  readonly pending: readonly PendingDeliverableUpload[];
  readonly states: Map<string, PendingDeliverableUpload['state']>;
  readonly controllers: Map<string, AbortController>;
  readonly sessions: Map<string, string>;
  readonly transfer: (input: Omit<FileTransfer, 'control'>) => Promise<DeliverableOut>;
  readonly retire: (id: string) => Promise<unknown>;
  readonly setPending: Dispatch<SetStateAction<PendingDeliverableUpload[]>>;
  readonly setError: Dispatch<SetStateAction<string>>;
  readonly onUploaded: (file: DeliverableOut) => void;
}

function updatePending(
  queue: UploadQueueContext,
  key: string,
  patch: Partial<PendingDeliverableUpload>,
): void {
  queue.setPending((current) =>
    current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
  );
}

async function uploadOne(queue: UploadQueueContext, item: PendingDeliverableUpload): Promise<void> {
  const state = queue.states.get(item.key);
  if (queue.disabled || (state !== 'queued' && state !== 'failed')) return;
  queue.states.set(item.key, 'uploading');
  queue.setError('');
  updatePending(queue, item.key, { state: 'uploading', progress: 0 });
  try {
    const controller = new AbortController();
    queue.controllers.set(item.key, controller);
    const uploaded = await queue.transfer({
      file: item.file,
      requestId: item.key,
      destination: { kind: 'draft' },
      signal: controller.signal,
      onSession: (id) => queue.sessions.set(item.key, id),
      onProgress: (progress) => {
        updatePending(queue, item.key, { progress });
      },
    });
    queue.controllers.delete(item.key);
    queue.sessions.delete(item.key);
    queue.onUploaded(uploaded);
    queue.setPending((current) => current.filter((candidate) => candidate.key !== item.key));
    queue.states.delete(item.key);
  } catch {
    const state = queue.controllers.get(item.key)?.signal.aborted ? 'cancelled' : 'failed';
    queue.controllers.delete(item.key);
    queue.states.set(item.key, state);
    updatePending(queue, item.key, {
      state,
    });
    if (state !== 'cancelled')
      queue.setError('One or more files could not upload. Retry that file or remove it.');
  }
}

/** Validate the selection and upload its files sequentially. */
export async function selectUploads(
  queue: UploadQueueContext,
  selected: readonly File[],
): Promise<void> {
  if (queue.disabled) return;
  queue.setError('');
  if (selected.length + queue.fileCount + queue.pending.length > 10) {
    queue.setError('Attach up to 10 files per post.');
    return;
  }
  if (selected.some((file) => file.size === 0 || file.size > MAX_UPLOAD_BYTES)) {
    queue.setError('Choose non-empty files up to 100 MiB each.');
    return;
  }
  const queued = selected.map((file) => ({
    key: crypto.randomUUID(),
    file,
    state: 'queued' as const,
    progress: 0,
  }));
  for (const item of queued) queue.states.set(item.key, 'queued');
  queue.setPending((current) => [...current, ...queued]);
  for (const item of queued) await uploadOne(queue, item);
}

/** Explicitly restart one failed or cancelled file. */
export async function retryUpload(queue: UploadQueueContext, key: string): Promise<void> {
  const item = queue.pending.find((candidate) => candidate.key === key);
  if (item && item.state !== 'uploading') {
    queue.states.set(key, 'queued');
    await uploadOne(queue, item);
  }
}

/** Cancel a queued file or abort its current byte transfer. */
export function cancelUpload(queue: UploadQueueContext, key: string): void {
  queue.states.set(key, 'cancelled');
  const controller = queue.controllers.get(key);
  if (controller) controller.abort();
  else updatePending(queue, key, { state: 'cancelled' });
}

/** Forget an unposted local file after it has stopped uploading. */
export function removePendingUpload(queue: UploadQueueContext, key: string): void {
  const session = queue.sessions.get(key);
  if (session) void queue.retire(session).catch(() => undefined);
  queue.sessions.delete(key);
  queue.controllers.delete(key);
  queue.states.delete(key);
  queue.setPending((current) => current.filter((item) => item.key !== key));
}
