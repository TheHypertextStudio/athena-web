import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { relativeToWorkspaceRoot, WORKSPACE_ROOT } from '../workspace';

const DOMAIN_IDS = [
  'athena',
  'automation',
  'connections',
  'identity-access',
  'notifications',
  'planning',
  'work',
] as const;
const VALID_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const INVALID_IDS = [
  '01arz3ndektsv4rrffq69g5fav',
  '01ARZ3NDEKTSV4RRFFQ69G5FA',
  '01ARZ3NDEKTSV4RRFFQ69G5FAVI',
  '550e8400-e29b-41d4-a716-446655440000',
] as const;

interface RuntimeSchema {
  safeParse(value: unknown): { success: boolean };
}

function isRuntimeSchema(value: unknown): value is RuntimeSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    'safeParse' in value &&
    typeof value.safeParse === 'function'
  );
}

describe('domain id policy', () => {
  it.each(DOMAIN_IDS)(
    '%s owns branded ULID schemas with identical runtime behavior',
    async (id) => {
      const sourcePath = resolve(WORKSPACE_ROOT, 'domains', id, 'src', 'ids.ts');
      expect(existsSync(sourcePath), `${relativeToWorkspaceRoot(sourcePath)} is missing`).toBe(
        true,
      );
      const module = (await import(pathToFileURL(sourcePath).href)) as Record<string, unknown>;
      const schemas = Object.entries(module).filter(
        (entry): entry is [string, RuntimeSchema] =>
          entry[0].endsWith('Id') && entry[0] !== 'Id' && isRuntimeSchema(entry[1]),
      );

      expect(schemas.length, `${id} must export at least one owned id schema`).toBeGreaterThan(0);
      expect(module).not.toHaveProperty('Id');
      expect(module).not.toHaveProperty('ULID_REGEX');
      for (const [name, schema] of schemas) {
        expect(schema.safeParse(VALID_ULID).success, `${id}/${name} rejected a valid ULID`).toBe(
          true,
        );
        for (const invalid of INVALID_IDS) {
          expect(schema.safeParse(invalid).success, `${id}/${name} accepted ${invalid}`).toBe(
            false,
          );
        }
      }
    },
  );
});
