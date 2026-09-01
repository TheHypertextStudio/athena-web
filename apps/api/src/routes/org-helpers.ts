import { db, type GrantCapability, organization } from '@docket/db';
import { PUBLIC_SLUG_MAX_LENGTH, RESERVED_PUBLIC_SLUGS } from '@docket/work/slug-contract';
import { type OrgOut } from '../contracts/organization';
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

/**
 * Whether `s` is free to become an organization's slug: not one of the reserved system names, and
 * not already held by another organization.
 *
 * @remarks
 * The reserved-word check matters here specifically for the **auto-derive** path — an explicit
 * slug is already screened by {@link PublicSlug}'s own `.refine` before it reaches this module, but
 * `slugify()`'s output never goes through Zod at all, so an org named "Settings" would otherwise
 * silently end up on the one path segment the product itself owns.
 */
async function isUsableSlug(s: string): Promise<boolean> {
  if (RESERVED_PUBLIC_SLUGS.includes(s)) return false;
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, s))
    .limit(1);
  return rows.length === 0;
}

/**
 * Resolve a slug that is free on the unique `organization_slug_uq` index and not reserved.
 *
 * @remarks
 * - An **auto-derived** slug is disambiguated with a sequential numeric suffix (`-2`, `-3`, …) —
 *   this is now always a workspace's default public brief address too, and a numeric suffix reads
 *   far better in a shared link than a random one would.
 * - An **explicit** slug throws a clean {@link ConflictError} on collision.
 *
 * @param base - The candidate slug.
 * @param explicit - Whether the caller supplied the slug explicitly.
 * @returns a slug not currently used by any organization.
 * @throws {ConflictError} when `explicit` is true and the slug is already taken, or when no
 *   auto-derived candidate resolves within the attempt budget.
 */
export async function resolveUniqueSlug(base: string, explicit: boolean): Promise<string> {
  if (await isUsableSlug(base)) return base;
  if (explicit) throw new ConflictError(`The slug '${base}' is already taken.`);

  for (let attempt = 2; attempt <= 12; attempt += 1) {
    const suffix = `-${attempt}`;
    const candidate = `${base.slice(0, PUBLIC_SLUG_MAX_LENGTH - suffix.length)}${suffix}`;
    if (await isUsableSlug(candidate)) return candidate;
  }
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
