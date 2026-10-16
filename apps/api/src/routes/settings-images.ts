/** Public reads of the currently selected raster profile and workspace images. */
import { db, organization, user } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import type { AppEnv } from '../context';
import { getContainer } from '../container';
import { NotFoundError } from '../error';
import {
  MAX_SETTINGS_IMAGE_BYTES,
  settingsImageUrl,
  type SettingsImageKind,
} from '../lib/settings-image';

/** Identify only the raster formats accepted by Settings; never trust object metadata alone. */
function rasterMime(bytes: Uint8Array): string | null {
  const prefix = Buffer.from(bytes.subarray(0, 12));
  if (prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255) return 'image/jpeg';
  const signature = prefix.toString('ascii');
  if (signature.startsWith('GIF87a') || signature.startsWith('GIF89a')) return 'image/gif';
  if (signature.startsWith('RIFF') && signature.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Read a record's active selected image reference before touching the private bucket. */
async function selectedReference(kind: SettingsImageKind, id: string): Promise<string | null> {
  if (kind === 'profile') {
    const [row] = await db.select({ url: user.image }).from(user).where(eq(user.id, id)).limit(1);
    return row?.url ?? null;
  }
  const [row] = await db
    .select({ url: organization.avatar })
    .from(organization)
    .where(and(eq(organization.id, id), isNull(organization.archivedAt)))
    .limit(1);
  return row?.url ?? null;
}

/**
 * Anonymous avatar reads, mounted outside the session-gated typed API.
 *
 * Only deterministic Settings keys whose record still selects this exact API URL are addressable.
 * Removed/replaced/external references and private artifact prefixes are never served here.
 */
export const settingsImages: Hono<AppEnv> = new Hono<AppEnv>().get(
  '/:kind/:id',
  describeRoute({
    tags: ['Me'],
    summary: 'Read a selected profile or workspace image',
    description:
      'Returns the currently selected raster avatar without a session. Unknown, removed, archived, external, or mismatched image references return 404. The private storage address is never exposed.',
    security: [],
  }),
  async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    const { kind, id } = c.req.param();
    if ((kind !== 'profile' && kind !== 'workspace') || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new NotFoundError('Image not found');
    }
    if ((await selectedReference(kind, id)) !== settingsImageUrl(kind, id)) {
      throw new NotFoundError('Image not found');
    }
    const bytes = await getContainer().blob.get(`settings/${kind}/${id}`);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_SETTINGS_IMAGE_BYTES) {
      throw new NotFoundError('Image not found');
    }
    const mimeType = rasterMime(bytes);
    if (!mimeType) throw new NotFoundError('Image not found');
    return c.body(new Uint8Array(bytes), 200, {
      'Content-Type': mimeType,
      'Content-Disposition': 'inline',
      'Content-Length': String(bytes.length),
    });
  },
);
