/**
 * Human-readable byte-size formatting.
 *
 * @remarks
 * The shared home for rendering file/artifact sizes, so components don't each redefine the
 * `1024`-step ladder. Rounds to whole `KB` and one-decimal `MB`.
 */

/** Format a byte count as a compact human label (`B` / `KB` / `MB`), or `null` when unknown. */
export function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${String(Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
