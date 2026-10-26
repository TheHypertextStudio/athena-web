import type { z } from 'zod';
import type { attachment } from '@docket/db';
import {
  MAX_RESOURCE_BYTES,
  UploadResourceInput,
  type AttachResourceInput,
} from '../contracts/resource-write';
import { invalidResourceField } from './resource-validation';
import type { LibraryRef } from '../contracts/library';
import type { SearchCaller } from '../search/query';
import { loadLibrarySource } from './library-reader';
import { getContainer } from '../container';
import { MAX_UPLOAD_BYTES } from '@docket/work/attachment-contract';
import { linkedResourceMaterial } from './resource-url';

/** Validated material for one destination-owned attachment; never carries provider credentials. */
export interface ResourceMaterial {
  readonly kind: 'file' | 'url';
  readonly title: string;
  readonly bytes?: Uint8Array;
  readonly copyFromKey?: string;
  readonly byteSize?: number;
  readonly crc32c?: string;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly url?: string;
  readonly externalResourceId?: string;
  readonly disposition: 'uploaded' | 'copied' | 'linked';
  readonly source?: LibraryRef;
}

/** Decode only canonical bounded base64; Node's otherwise permissive decoder is insufficient. */
export function uploadMaterial(input: z.infer<typeof UploadResourceInput>): ResourceMaterial {
  const bytes = Buffer.from(input.contentBase64, 'base64');
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_RESOURCE_BYTES ||
    bytes.toString('base64') !== input.contentBase64
  ) {
    invalidResourceField('contentBase64');
  }
  return {
    kind: 'file',
    title: input.title ?? input.fileName,
    bytes,
    fileName: input.fileName,
    mimeType: input.mimeType,
    disposition: 'uploaded',
  };
}

/** Recheck source visibility and create a credential-free link or immutable file snapshot. */
export async function attachedMaterial(
  caller: SearchCaller,
  input: z.infer<typeof AttachResourceInput>,
  actorId: string,
): Promise<ResourceMaterial> {
  const source = { orgId: input.orgId, ...input.resource };
  const row = await loadLibrarySource(caller, source);
  if ('canonicalUrl' in row) {
    return {
      kind: 'url',
      title: input.title ?? row.title ?? row.canonicalUrl,
      url: row.canonicalUrl,
      externalResourceId: row.id,
      disposition: 'linked',
      source,
    };
  }
  if (row.kind === 'url' && row.url) {
    return {
      ...(await linkedResourceMaterial(input.orgId, actorId, row.url, input.title ?? row.title)),
      source,
    };
  }
  if (row.kind !== 'file') invalidResourceField('resource');
  return fileSnapshot(row, input.title, source);
}

async function fileSnapshot(
  row: typeof attachment.$inferSelect,
  title: string | undefined,
  source: LibraryRef,
): Promise<ResourceMaterial> {
  if (!row.blobKey) invalidResourceField('resource');
  const file = await getContainer().blob.transfer.stat(row.blobKey);
  if (!file || file.byteSize === 0 || file.byteSize > MAX_UPLOAD_BYTES)
    invalidResourceField('resource');
  const metadata = UploadResourceInput.pick({ fileName: true, mimeType: true }).safeParse({
    fileName: row.fileName,
    mimeType: row.mimeType ?? 'application/octet-stream',
  });
  if (!metadata.success) invalidResourceField('resource');
  return {
    kind: 'file',
    title: title ?? row.title,
    copyFromKey: row.blobKey,
    byteSize: file.byteSize,
    crc32c: file.crc32c,
    ...metadata.data,
    disposition: 'copied',
    source,
  };
}
