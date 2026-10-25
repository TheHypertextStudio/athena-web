import { createHash } from 'node:crypto';
import type { BlueprintInvocationOverride } from '@docket/db';
/** Preserve valid authored keys and deterministically encode only incompatible compatibility keys. */
export function canonicalSourceKey(key: string): string {
  return /^[a-z][a-z0-9_-]{0,63}$/.test(key)
    ? key
    : `legacy_${createHash('sha256').update(key).digest('hex').slice(0, 48)}`;
}
/** Preserve private literal fields and labels without loading or manufacturing normalized source rows. */
export function privateDefinitionFields(
  spec: Readonly<Record<string, unknown>>,
  labelIds: readonly string[],
): BlueprintInvocationOverride['fields'] {
  const fields: Record<string, string | number | null | readonly string[]> = {};
  for (const [key, value] of Object.entries(spec))
    if (typeof value === 'string' || typeof value === 'number' || value === null)
      fields[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = value;
  if (labelIds.length) fields['labelIds'] = labelIds;
  return fields;
}
