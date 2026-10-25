import type { Dispatch, SetStateAction } from 'react';
import type { DeliverableOut } from '@docket/work/attachment-contract';
import { surfaceHeaders } from './provenance/surface';

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
  readonly xhrs: Map<string, XMLHttpRequest>;
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
    const uploaded = await new Promise<DeliverableOut>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      queue.xhrs.set(item.key, xhr);
      xhr.open('POST', `/v1/orgs/${encodeURIComponent(queue.orgId)}/deliverables`);
      xhr.withCredentials = true;
      for (const [name, value] of Object.entries(surfaceHeaders()))
        xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          updatePending(queue, item.key, {
            progress: Math.min(99, Math.floor((event.loaded / event.total) * 100)),
          });
      };
      xhr.onload = () => {
        queue.xhrs.delete(item.key);
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error('upload_failed'));
          return;
        }
        try {
          resolve(JSON.parse(xhr.responseText) as DeliverableOut);
        } catch {
          reject(new Error('upload_failed'));
        }
      };
      xhr.onerror = () => {
        queue.xhrs.delete(item.key);
        reject(new Error('upload_failed'));
      };
      xhr.onabort = () => {
        queue.xhrs.delete(item.key);
        reject(new Error('upload_cancelled'));
      };
      const form = new FormData();
      form.set('file', item.file);
      form.set('uploadId', item.key);
      xhr.send(form);
    });
    queue.onUploaded(uploaded);
    queue.setPending((current) => current.filter((candidate) => candidate.key !== item.key));
    queue.states.delete(item.key);
  } catch (caught) {
    const state =
      caught instanceof Error && caught.message === 'upload_cancelled' ? 'cancelled' : 'failed';
    queue.states.set(item.key, state);
    updatePending(queue, item.key, {
      state,
    });
    if (!(caught instanceof Error && caught.message === 'upload_cancelled'))
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
  if (selected.some((file) => file.size === 0 || file.size > 4 * 1024 * 1024)) {
    queue.setError('Choose non-empty files up to 4 MB each.');
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
  const xhr = queue.xhrs.get(key);
  if (xhr) xhr.abort();
  else updatePending(queue, key, { state: 'cancelled' });
}

/** Forget an unposted local file after it has stopped uploading. */
export function removePendingUpload(queue: UploadQueueContext, key: string): void {
  queue.states.delete(key);
  queue.setPending((current) => current.filter((item) => item.key !== key));
}
