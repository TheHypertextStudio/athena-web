import { getContainer } from '../container';
import { ConflictError } from '../error';
import type { ResourceMaterial } from './resource-write-input';

/** Store or independently copy reserved resource bytes without whole-object reads. */
export async function writeResourceBytes(
  blobKey: string | null,
  material: ResourceMaterial,
): Promise<void> {
  if (!blobKey) return;
  const blob = getContainer().blob;
  if (material.bytes)
    await blob.put(blobKey, material.bytes, material.mimeType ?? 'application/octet-stream');
  if (!material.copyFromKey) return;
  const existing = await blob.transfer.stat(blobKey);
  if (!existing)
    await blob.transfer.copy(
      material.copyFromKey,
      blobKey,
      material.mimeType ?? 'application/octet-stream',
    );
  const copied = existing ?? (await blob.transfer.stat(blobKey));
  if (!copied || copied.crc32c !== material.crc32c || copied.byteSize !== material.byteSize)
    throw new ConflictError();
}
