/** Managed storage for raster images selected in Settings. */
import { SettingsImageData } from '@docket/identity-access/settings-image-contract';

import { getContainer } from '../container';
import { env } from '../env';

/** Maximum decoded image size accepted by the Settings UI and API. */
export const MAX_SETTINGS_IMAGE_BYTES = 1024 * 1024;

/** The two record types whose selected raster images may be served publicly. */
export type SettingsImageKind = 'profile' | 'workspace';

/** Return a stable API URL for a selected image, independent of storage-provider addresses. */
export function settingsImageUrl(kind: SettingsImageKind, id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid Settings image record.');
  return `${env.API_URL.replace(/\/+$/, '')}/v1/public/settings-images/${kind}/${id}`;
}

/** Decode and persist a selected image under a deterministic, overwrite-safe blob key. */
export async function storeSettingsImage(key: string, input: string): Promise<string> {
  const keyMatch = /^settings\/(profile|workspace)\/([A-Za-z0-9_-]{1,128})$/.exec(key);
  if (!keyMatch?.[1] || !keyMatch[2]) throw new Error('Invalid Settings image key.');
  const url = settingsImageUrl(keyMatch[1] as SettingsImageKind, keyMatch[2]);
  const dataUrl = SettingsImageData.parse(input);
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  /* v8 ignore next -- @preserve SettingsImageData already proves this shape */
  if (!match?.[1] || !match[2]) throw new Error('Invalid Settings image.');
  const bytes = new Uint8Array(Buffer.from(match[2], 'base64'));
  if (bytes.length === 0 || bytes.length > MAX_SETTINGS_IMAGE_BYTES) {
    throw new Error('Settings image exceeds the allowed size.');
  }
  await getContainer().blob.put(key, bytes, match[1]);
  return url;
}

/** Remove the deterministic Settings image blob. Safe when no blob exists. */
export async function deleteSettingsImage(key: string): Promise<void> {
  await getContainer().blob.delete(key);
}
