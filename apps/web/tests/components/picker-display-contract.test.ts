import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('Picker display contract', () => {
  it('joins configured display rows in direct Project and Task property pickers', () => {
    const projectDetail = source('apps/web/src/lib/use-project-detail-page.ts');
    const taskDetail = source(
      'apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/task-detail-client.tsx',
    );

    expect(projectDetail).toContain("queryKeys.entityDisplays(orgId, 'initiative')");
    expect(projectDetail).toContain('toInitiativeOptions(initiatives, initiativeDisplays)');
    expect(taskDetail).toContain("queryKeys.entityDisplays(orgId, 'project')");
    expect(taskDetail).toContain('toProjectOptions(projects, projectDisplays)');
  });

  it('uses the shared display mutation that invalidates bulk caches after every supported icon editor', () => {
    const sources = [
      source(
        'apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx',
      ),
      source('apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx'),
      source('apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx'),
    ];
    sources.forEach((contents) => {
      expect(contents).toContain('useEntityDisplay({');
    });

    const displayHook = source('apps/web/src/components/entity-display/use-entity-display.ts');
    expect(displayHook).toContain('queryKeys.entityDisplays(organizationId, subjectType)');
  });
});
