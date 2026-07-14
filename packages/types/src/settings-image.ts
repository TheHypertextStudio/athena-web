/** `@docket/types` — safe image payloads used by user-facing Settings editors. */
import { z } from 'zod';

/** Maximum encoded payload accepted by the API (a 1 MB binary image plus base64 overhead). */
export const MAX_SETTINGS_IMAGE_DATA_LENGTH = 1_500_000;

/** A browser-selected raster image before the API moves it into managed blob storage. */
export const SettingsImageData = z
  .string()
  .max(MAX_SETTINGS_IMAGE_DATA_LENGTH)
  .regex(/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/)
  .refine((value) => {
    const payload = value.slice(value.indexOf(',') + 1);
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    return Math.floor((payload.length * 3) / 4) - padding <= 1024 * 1024;
  }, 'Choose an image smaller than 1 MB.')
  .describe('A JPG, PNG, WebP, or GIF data URL awaiting managed storage.');
/** Settings image upload value. */
export type SettingsImageData = z.infer<typeof SettingsImageData>;

/** An existing image URL or a newly selected raster image. */
export const SettingsImageValue = z.union([
  z.url().refine((value) => value.startsWith('https://') || value.startsWith('http://'), {
    message: 'Expected an HTTP(S) image URL.',
  }),
  SettingsImageData,
]);
/** Existing-or-new Settings image value. */
export type SettingsImageValue = z.infer<typeof SettingsImageValue>;
