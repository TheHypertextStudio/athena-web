import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

describe('ambient Athena entry points', () => {
  it.each([
    'apps/web/src/app/(app)/tasks/all-tasks-client.tsx',
    'apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/task-detail-client.tsx',
    'apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx',
    'apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx',
    'apps/web/src/app/(app)/stream/page.tsx',
    'apps/web/src/app/(app)/calendar/calendar-client.tsx',
    'apps/web/src/app/(app)/inbox/inbox-client.tsx',
  ])('keeps the overview or detail route %s free of a page-local Athena button', (path) => {
    expect(read(path)).not.toContain('AthenaContextAction');
  });

  it('keeps Athena available as a contextual task-menu action instead of a page button', () => {
    const controls = read('apps/web/src/components/task-detail/task-header-controls.tsx');
    const detail = read('apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/task-detail-client.tsx');
    expect(controls).toContain('AthenaContextMenuItem');
    expect(controls).toContain('Have Athena handle this');
    expect(detail).toContain("source: { type: 'task'");
  });

  it('routes the Today prompt into the shared dock instead of creating a local mini session UI', () => {
    const source = read('apps/web/src/components/today/today-prompt.tsx');
    expect(source).toContain('useAthenaPanel');
    // The contextual door `/today` used to carry as a masthead button. It hands Athena the
    // workspace *and* the draft, so it is strictly more contextual than the button was.
    expect(source).toContain('openAthena({ workspaceId: orgId, workspaceName: orgLabel }');
    expect(source).toContain('CaptureMode');
    expect(source).not.toContain("api.v1.orgs[':orgId'].sessions.$post");
    expect(source).not.toContain('AthenaSessionNotice');
    expect(source).not.toContain('SessionStatusPill');
  });
});
