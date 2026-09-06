/**
 * `@docket/api` — the Docket mark, served from the API's own origin.
 *
 * @remarks
 * An MCP client finds a connector's icon in two places, and neither reached the artwork. It reads
 * `serverInfo.icons`, which pointed at the web origin while this server answers on the API origin —
 * the MCP schema asks a consumer to prefer icons "from the same domain as the client/server". And
 * before it connects it has only an origin, so it guesses `/favicon.ico`, which every unmatched
 * path here answered with a 405.
 *
 * The bytes come from `@docket/brand/embedded-icons` rather than from disk: `scripts/
 * build-runtime.mjs` bundles this app to a single `dist/server.mjs` and its image copies no static
 * directory, so an icon read with `readFile` would 500 in production and pass in dev.
 *
 * @see {@link file://../../../../packages/brand/src/render-embedded.ts} which generates them.
 */
import {
  MARK_192_PNG_BASE64,
  MARK_512_PNG_BASE64,
  MARK_ICO_BASE64,
} from '@docket/brand/embedded-icons';
import { Hono } from 'hono';

import type { AppEnv } from '../context';

/** A day. Without it every client refetches the image on every render of a connector list. */
const CACHE_CONTROL = 'public, max-age=86400';

/** One served icon. */
export interface ServedIcon {
  /** Path on this origin, which is also what `mcp/server.ts` advertises. */
  readonly path: string;
  readonly mimeType: string;
  /** Renditions inside the file, in the `WxH` form MCP's `Icon.sizes` takes. */
  readonly sizes: readonly string[];
  /** Explicitly `ArrayBuffer`-backed, which is all Hono's `c.body` accepts. */
  readonly body: Uint8Array<ArrayBuffer>;
}

/**
 * Decode a generated payload once, at import.
 *
 * @param base64 - The payload from `@docket/brand/embedded-icons`.
 * @returns The image bytes.
 */
function decode(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

/**
 * Every icon this origin serves.
 *
 * @remarks
 * The PNG paths match the web app's, so both origins answer the same URL with the same bytes.
 * `mcp/server.ts` builds its advertised `icons` from this list instead of restating the paths.
 */
export const SERVED_ICONS: readonly ServedIcon[] = [
  {
    path: '/icons/icon-192.png',
    mimeType: 'image/png',
    sizes: ['192x192'],
    body: decode(MARK_192_PNG_BASE64),
  },
  {
    path: '/icons/icon-512.png',
    mimeType: 'image/png',
    sizes: ['512x512'],
    body: decode(MARK_512_PNG_BASE64),
  },
  {
    path: '/favicon.ico',
    // The de facto type, not the registered `image/vnd.microsoft.icon`, because it is what
    // consumers of a favicon match on.
    mimeType: 'image/x-icon',
    sizes: ['16x16', '32x32', '48x48'],
    body: decode(MARK_ICO_BASE64),
  },
];

/** The routes serving {@link SERVED_ICONS}, mounted at the root of the API. */
export const brandIcons = new Hono<AppEnv>();

for (const { path, mimeType, body } of SERVED_ICONS) {
  brandIcons.get(path, (c) =>
    c.body(body, 200, {
      'Content-Type': mimeType,
      'Content-Length': String(body.byteLength),
      'Cache-Control': CACHE_CONTROL,
    }),
  );
}
