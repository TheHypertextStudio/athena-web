import { db, type GrantCapability, organization } from '@docket/db';
import type { OrgOut } from '@docket/types';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError } from '../error';

type OrgRow = typeof organization.$inferSelect;

/** toOrgOut converts internal API route data into the public API response shape. */
export function toOrgOut(o: OrgRow): z.input<typeof OrgOut> {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    purpose: o.purpose,
    avatar: o.avatar,
    isPersonal: o.isPersonal,
    vocabulary: o.vocabulary,
    lifecycleState: o.lifecycleState,
    createdAt: o.createdAt.toISOString(),
  };
}

/** slugify converts an organization name into a URL-safe slug candidate. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'org'
  );
}

/** A short, slug-safe random suffix used to disambiguate a colliding auto-derived slug. */
export function slugSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Resolve a slug that is free on the unique `organization_slug_uq` index.
 *
 * @remarks
 * - An **auto-derived** slug is silently disambiguated with a short random suffix.
 * - An **explicit** slug throws a clean {@link ConflictError} on collision.
 *
 * @param base - The candidate slug.
 * @param explicit - Whether the caller supplied the slug explicitly.
 * @returns a slug not currently used by any organization.
 * @throws {ConflictError} when `explicit` is true and the slug is already taken.
 */
export async function resolveUniqueSlug(base: string, explicit: boolean): Promise<string> {
  const taken = async (s: string): Promise<boolean> => {
    const rows = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, s))
      .limit(1);
    return rows.length > 0;
  };

  if (!(await taken(base))) return base;
  if (explicit) throw new ConflictError(`The slug '${base}' is already taken.`);

  // Disambiguate the auto-derived slug, trimming the base so the suffix fits in 48 chars.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = `${base.slice(0, 41)}-${slugSuffix()}`;
    if (!(await taken(candidate))) return candidate;
  }
  /* v8 ignore next -- @preserve defensive: six random 6-char suffixes practically never all collide */
  throw new ConflictError('Could not allocate a unique slug for the organization.');
}

/** The 4 seeded system roles + their org-root base capability. */
export const SYSTEM_ROLES: {
  key: string;
  name: string;
  baseCapability: GrantCapability | null;
  defaultVisibility: 'public' | 'private';
  capabilities: GrantCapability[];
}[] = [
  {
    key: 'owner',
    name: 'Owner',
    baseCapability: 'manage',
    defaultVisibility: 'public',
    capabilities: ['view', 'comment', 'contribute', 'assign', 'manage'],
  },
  {
    key: 'admin',
    name: 'Admin',
    baseCapability: 'manage',
    defaultVisibility: 'public',
    capabilities: ['view', 'comment', 'contribute', 'assign', 'manage'],
  },
  {
    key: 'member',
    name: 'Member',
    baseCapability: 'contribute',
    defaultVisibility: 'public',
    capabilities: ['view', 'comment', 'contribute'],
  },
  {
    key: 'guest',
    name: 'Guest',
    baseCapability: null,
    defaultVisibility: 'private',
    capabilities: [],
  },
];
