/** Managed storage for raster images selected in Settings. */
import { SettingsImageData } from '@docket/types';

import { getContainer } from '../container';

/** Maximum decoded image size accepted by the Settings UI and API. */
export const MAX_SETTINGS_IMAGE_BYTES = 1024 * 1024;

/** Decode and persist a selected image under a deterministic, overwrite-safe blob key. */
export async function storeSettingsImage(key: string, input: string): Promise<string> {
  const dataUrl = SettingsImageData.parse(input);
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  /* v8 ignore next -- @preserve SettingsImageData already proves this shape */
  if (!match?.[1] || !match[2]) throw new Error('Invalid Settings image.');
  const bytes = new Uint8Array(Buffer.from(match[2], 'base64'));
  if (bytes.length === 0 || bytes.length > MAX_SETTINGS_IMAGE_BYTES) {
    throw new Error('Settings image exceeds the allowed size.');
  }
  const stored = await getContainer().blob.put(key, bytes, match[1]);
  // LocalDiskBlob has no HTTP server of its own. Keep its test/dev value renderable while every
  // production adapter persists only the managed public URL in relational rows.
  return stored.url.startsWith('file:') ? dataUrl : stored.url;
}

/** Remove the deterministic Settings image blob. Safe when no blob exists. */
export async function deleteSettingsImage(key: string): Promise<void> {
  await getContainer().blob.delete(key);
}
