/**
 * `settings` — plain-language descriptions for the four system roles.
 *
 * @remarks
 * The org seeds four system roles keyed `owner` / `admin` / `member` / `guest`. Settings
 * surfaces them in plain language (no capability jargon): a short "what they can do" line
 * accompanies each so a non-technical owner can assign access with confidence. The "Guest"
 * concept is additionally carried by an invitation's `asGuest` flag — a guest is a limited
 * outside collaborator — which the member list renders as a badge.
 *
 * Keyed off the role `key` (immutable for system roles), so a relabeled role name still
 * resolves to the right description.
 */

/** The four system role keys, ordered most-privileged first. */
export const ROLE_KEY_ORDER = ['owner', 'admin', 'member', 'guest'] as const;

/** A system role key. */
export type RoleKey = (typeof ROLE_KEY_ORDER)[number];

/** A plain-language label + one-line "what they can do" for a system role. */
export interface RolePlainLanguage {
  /** The human label (e.g. "Owner"). */
  readonly label: string;
  /** A jargon-free description of what the role can do. */
  readonly summary: string;
}

/** Plain-language copy for each system role, keyed by its immutable `key`. */
export const ROLE_PLAIN_LANGUAGE: Record<RoleKey, RolePlainLanguage> = {
  owner: {
    label: 'Owner',
    summary: 'Full control — manage everyone, billing, and every setting.',
  },
  admin: {
    label: 'Admin',
    summary: 'Manage members, work, and integrations, but not ownership.',
  },
  member: {
    label: 'Member',
    summary: 'Create and contribute to work across the organization.',
  },
  guest: {
    label: 'Guest',
    summary: 'A limited outside collaborator with access only where invited.',
  },
};

/** Narrow an arbitrary role `key` string to a known {@link RoleKey}, or `null`. */
export function asRoleKey(key: string): RoleKey | null {
  return (ROLE_KEY_ORDER as readonly string[]).includes(key) ? (key as RoleKey) : null;
}
