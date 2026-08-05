/**
 * Where the generated assets land. Kept in one module so a renderer cannot quietly start writing
 * outside its own territory, and so the tests can assert that separation by reading this file.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, four levels up from `packages/brand/src`. */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The Next.js product app, which owns every served icon. */
export const WEB_ROOT = join(REPO_ROOT, 'apps/web');

/** The favicon Next serves at `/icon.svg`. */
export const WEB_ICON = join(WEB_ROOT, 'src/app/icon.svg');

/** The offline fallback page, which inlines the mark rather than requesting it. */
export const OFFLINE_PAGE = join(WEB_ROOT, 'public/offline.html');

/** Directory holding the manifest's `any` and `maskable` icons. */
export const PWA_ICONS_DIR = join(WEB_ROOT, 'public/icons');

/** The committed Icon Composer document every Apple asset is exported from. */
export const ICON_DOCUMENT = join(WEB_ROOT, 'design/Docket.icon');

/** The mark layer inside that document. */
export const APPLE_LAYER = join(ICON_DOCUMENT, 'Assets/Bars.svg');

/** Reviewable full-resolution renders, not served to anyone. */
export const EXPORTS_DIR = join(WEB_ROOT, 'design/exports');

/** Size the mark is displayed at inside the offline page's disc. */
export const OFFLINE_MARK_SIZE = 28;
