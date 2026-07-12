/**
 * Whether a value is usable as a real external credential rather than a local/test sentinel.
 *
 * @remarks
 * This module intentionally has no schema or runtime-environment imports so deployment tooling
 * can reuse the exact production credential policy without loading the fail-fast env composition.
 */
export function isRealValue(value: string | undefined | null): value is string {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (v.length === 0) return false;
  return !(
    v.endsWith('...') ||
    v.includes('placeholder') ||
    v.includes('changeme') ||
    v.includes('change-me') ||
    v.includes('your-') ||
    v === 'mock'
  );
}

/**
 * Return the trimmed usable env value, or `undefined` for absent/placeholder values.
 *
 * @param value - The candidate environment or secret value.
 * @returns The normalized value only when it passes {@link isRealValue}.
 */
export function realEnvValue(value: string | undefined | null): string | undefined {
  return isRealValue(value) ? value.trim() : undefined;
}
