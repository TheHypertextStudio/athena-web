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
import { readAttachmentFile } from './attachment-file';
import { linkedResourceMaterial } from './resource-url';

/** Validated material for one destination-owned attachment; never carries provider credentials. */
export interface ResourceMaterial {
  readonly kind: 'file' | 'url';
  readonly title: string;
  readonly bytes?: Uint8Array;
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
  const file = await readAttachmentFile(row, MAX_RESOURCE_BYTES);
  if (file.status !== 'available' || file.bytes.byteLength === 0) invalidResourceField('resource');
  const metadata = UploadResourceInput.pick({ fileName: true, mimeType: true }).safeParse({
    fileName: row.fileName,
    mimeType: row.mimeType ?? 'application/octet-stream',
  });
  if (!metadata.success) invalidResourceField('resource');
  return {
    kind: 'file',
    title: title ?? row.title,
    bytes: file.bytes,
    ...metadata.data,
    disposition: 'copied',
    source,
  };
}
