import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { isObjectDetailPath, signInReturnPath } from '../../src/components/app-shell-utils';

const root = resolve(import.meta.dirname, '../../../..');
const shellFrame = readFileSync(join(root, 'apps/web/src/components/app-shell-frame.tsx'), 'utf8');
const shellUtils = readFileSync(join(root, 'apps/web/src/components/app-shell-utils.tsx'), 'utf8');

describe('signInReturnPath', () => {
  it('returns a protected export link to the exact same-origin path after sign-in', () => {
    expect(signInReturnPath('/exports/01JEXPORT')).toBe('/sign-in?next=%2Fexports%2F01JEXPORT');
  });

  it('preserves a protected route query without exposing it as an outer URL parameter', () => {
    expect(signInReturnPath('/tasks', 'view=assigned&filter=urgent')).toBe(
      '/sign-in?next=%2Ftasks%3Fview%3Dassigned%26filter%3Durgent',
    );
  });
});

describe('object detail shell treatment', () => {
  it('classifies concrete work-object routes without swallowing their overview routes', () => {
    expect(shellUtils).toContain('export function isObjectDetailPath');
    expect(shellUtils).toContain("'projects'");
    expect(shellUtils).toContain("'initiatives'");
    expect(shellUtils).toContain("'tasks'");
    expect(shellUtils).toContain("'programs'");
    expect(shellUtils).toContain("'cycles'");
    expect(isObjectDetailPath('/orgs/org_1/projects/project_1')).toBe(true);
    expect(isObjectDetailPath('/orgs/org_1/initiatives/initiative_1')).toBe(true);
    expect(isObjectDetailPath('/orgs/org_1/tasks/task_1')).toBe(true);
    expect(isObjectDetailPath('/orgs/org_1/programs/program_1')).toBe(true);
    expect(isObjectDetailPath('/orgs/org_1/cycles/cycle_1')).toBe(true);
    expect(isObjectDetailPath('/orgs/org_1/projects')).toBe(false);
    expect(isObjectDetailPath('/orgs/org_1/initiatives')).toBe(false);
    expect(isObjectDetailPath('/today')).toBe(false);
  });

  it('keeps the recovery nudge out of object-detail page flow', () => {
    expect(shellFrame).toContain('const objectDetailSurface = isObjectDetailPath(pathname);');
    expect(shellFrame).toContain('loading || settingsSurface || objectDetailSurface');
  });
});
