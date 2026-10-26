import { ApiRequestError } from './query-core';
import { Crc32c } from '@docket/blob-store/checksum';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_CHUNK_BYTES,
  type DeliverableOut,
  type WorkResourceSubjectType,
} from '@docket/work/attachment-contract';

/** One publication destination for the shared browser transfer. */
export type TransferDestination =
  { kind: 'draft' } | { kind: 'work'; subjectType: WorkResourceSubjectType; subjectId: string };
/** Immutable file metadata supplied to the typed control plane. */
export interface TransferDeclaration {
  readonly requestId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly crc32c: string;
  readonly destination: TransferDestination;
}
/** Minimal control-plane receipt, independent of provider transport. */
export interface TransferReceipt {
  readonly id: string;
  readonly state: string;
  readonly offset: number;
  readonly byteSize: number;
  readonly chunkSize: number;
  readonly uploadUrl?: string | undefined;
  readonly uploadToken?: string | undefined;
  readonly file?: DeliverableOut | undefined;
}
/** Typed metadata operations supplied by the application query layer. */
export interface UploadControl {
  readonly begin: (input: TransferDeclaration) => Promise<TransferReceipt>;
  readonly status: (id: string) => Promise<TransferReceipt>;
  readonly complete: (id: string) => Promise<TransferReceipt>;
  readonly cancel: (id: string) => Promise<unknown>;
}
/** Bounded byte operation at the browser's external IO edge. */
export interface ChunkTransfer {
  readonly session: TransferReceipt;
  readonly bytes: Blob;
  readonly offset: number;
  readonly total: number;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress: (loaded: number) => void;
}
/** Shared upload inputs, preserving a stable identity across explicit retries. */
export interface FileTransfer {
  readonly file: File;
  readonly requestId: string;
  readonly destination: TransferDestination;
  readonly control: UploadControl;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((percentage: number) => void) | undefined;
  readonly onSession?: ((id: string) => void) | undefined;
}
const checksums = new WeakMap<File, Promise<string>>();
async function checksum(file: File, signal?: AbortSignal): Promise<string> {
  const existing = checksums.get(file);
  if (existing) return existing;
  const crc = new Crc32c();
  for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_BYTES) {
    signal?.throwIfAborted();
    crc.update(new Uint8Array(await file.slice(offset, offset + UPLOAD_CHUNK_BYTES).arrayBuffer()));
  }
  const result = crc.digest();
  checksums.set(file, Promise.resolve(result));
  return result;
}

/** Transfer one file using provider acknowledgements; failures retain the same retry identity. */
export async function transferFile(
  input: FileTransfer,
  send: (chunk: ChunkTransfer) => Promise<number | null> = sendUploadChunk,
): Promise<DeliverableOut> {
  const { file, control, signal } = input;
  signal?.throwIfAborted();
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) throw new Error('upload_size');
  const session = await control.begin({
    requestId: input.requestId,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    byteSize: file.size,
    crc32c: await checksum(file, signal),
    destination: input.destination,
  });
  input.onSession?.(session.id);
  if (session.state === 'completed') return acceptedFile(session);
  await transferChunks(input, session, send);
  signal?.throwIfAborted();
  const result = acceptedFile(await control.complete(session.id));
  input.onProgress?.(100);
  return result;
}

function acceptedFile(receipt: TransferReceipt): DeliverableOut {
  if (!receipt.file || receipt.state !== 'completed') throw new Error('upload_incomplete');
  return receipt.file;
}
function progress(input: FileTransfer, loaded: number): void {
  input.onProgress?.(Math.min(99, Math.floor((loaded / input.file.size) * 100)));
}
async function transferChunks(
  input: FileTransfer,
  initial: TransferReceipt,
  send: (chunk: ChunkTransfer) => Promise<number | null>,
): Promise<void> {
  if (initial.state !== 'pending' || !initial.uploadUrl) throw new Error('upload_unavailable');
  let session = initial;
  let offset = session.offset;
  while (offset < input.file.size) {
    input.signal?.throwIfAborted();
    const end = Math.min(offset + UPLOAD_CHUNK_BYTES, input.file.size);
    const acknowledged = await send({
      session,
      bytes: input.file.slice(offset, end),
      offset,
      total: input.file.size,
      signal: input.signal,
      onProgress: (loaded) => {
        progress(input, offset + loaded);
      },
    });
    if (acknowledged === null) session = await input.control.status(session.id);
    const next = acknowledged ?? session.offset;
    assertAcknowledgement(next, offset, end);
    offset = next;
    progress(input, offset);
  }
}
function assertAcknowledgement(next: number, previous: number, end: number): void {
  if (!Number.isSafeInteger(next) || next <= previous || next > end)
    throw new Error('upload_acknowledgement');
}

/** Send only bytes and the scoped capability; never send Docket cookies or provenance to storage. */
export function sendUploadChunk(input: ChunkTransfer): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = (): void => {
      xhr.abort();
    };
    const done = (error?: Error): void => {
      input.signal?.removeEventListener('abort', abort);
      if (error) reject(error);
    };
    xhr.open('PUT', input.session.uploadUrl ?? '');
    xhr.withCredentials = false;
    xhr.setRequestHeader(
      'Content-Range',
      `bytes ${input.offset}-${input.offset + input.bytes.size - 1}/${input.total}`,
    );
    if (input.session.uploadToken)
      xhr.setRequestHeader('X-Docket-Upload-Token', input.session.uploadToken);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress(event.loaded);
    };
    xhr.onerror = () => {
      done(new ApiRequestError({ message: 'Could not upload the file. Try again.', status: 0 }));
    };
    xhr.onabort = () => {
      done(new Error('upload_cancelled'));
    };
    xhr.onload = () => {
      done();
      if (xhr.status === 200 || xhr.status === 201) {
        resolve(input.total);
        return;
      }
      if (xhr.status !== 308) {
        reject(
          new ApiRequestError({
            message: 'Could not upload the file. Try again.',
            status: xhr.status,
          }),
        );
        return;
      }
      const match = xhr.getResponseHeader('Range')?.match(/^bytes=0-(\d+)$/u);
      resolve(match ? Number(match[1]) + 1 : null);
    };
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) {
      done(new Error('upload_cancelled'));
      return;
    }
    xhr.send(input.bytes);
  });
}
