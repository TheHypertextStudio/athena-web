/**
 * `@docket/ui` — deterministic per-org accent color.
 *
 * @remarks
 * Each org gets a stable accent from a contrast-tuned 8-entry OKLCH palette, hashed
 * from `org.id` (no DB column). The AppShell sets `--org-accent` on context rebind so
 * the active org is always visually unambiguous.
 */

/** The 8-entry contrast-tuned OKLCH accent palette. */
export const ORG_ACCENT_PALETTE: readonly string[] = [
  'oklch(0.55 0.18 250)', // blue
  'oklch(0.55 0.17 300)', // violet
  'oklch(0.55 0.18 350)', // pink
  'oklch(0.5 0.2 25)', // red
  'oklch(0.55 0.15 60)', // amber
  'oklch(0.52 0.16 150)', // green
  'oklch(0.55 0.12 200)', // teal
  'oklch(0.5 0.13 280)', // indigo
];

/** Stable 32-bit hash of a string (FNV-1a). */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Return the deterministic accent OKLCH string for an org id. */
export function getOrgAccent(orgId: string): string {
  const palette = ORG_ACCENT_PALETTE;
  const accent = palette[hashString(orgId) % palette.length];
  /* v8 ignore start -- unreachable: `% palette.length` is always a valid index; this only narrows noUncheckedIndexedAccess. */
  if (accent === undefined) return 'oklch(0.55 0.18 250)';
  /* v8 ignore stop */
  return accent;
}
