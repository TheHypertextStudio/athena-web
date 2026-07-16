import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

describe('ambient Athena entry points', () => {
  it.each([
    'apps/web/src/app/(app)/today/page.tsx',
    'apps/web/src/app/(app)/tasks/all-tasks-client.tsx',
    'apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/page.tsx',
    'apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx',
    'apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/page.tsx',
    'apps/web/src/app/(app)/stream/page.tsx',
    'apps/web/src/app/(app)/calendar/calendar-client.tsx',
    'apps/web/src/app/(app)/inbox/inbox-client.tsx',
  ])('routes %s through the shared contextual action', (path) => {
    expect(read(path)).toContain('AthenaContextAction');
  });

  it('carries every supported object kind from the corresponding detailed surface', () => {
    expect(read('apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/page.tsx')).toContain(
      "type: 'task'",
    );
    expect(read('apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx')).toContain(
      "type: 'project'",
    );
    expect(
      read('apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/page.tsx'),
    ).toContain("type: 'initiative'");
    expect(read('apps/web/src/app/(app)/stream/page.tsx')).toContain("type: 'stream_event'");
    expect(read('apps/web/src/app/(app)/calendar/calendar-client.tsx')).toContain(
      "type: 'calendar_item'",
    );
  });

  it('routes the Today prompt into the shared dock instead of creating a local mini session UI', () => {
    const source = read('apps/web/src/components/today/today-prompt.tsx');
    expect(source).toContain('useAthenaPanel');
    expect(source).not.toContain("api.v1.orgs[':orgId'].sessions.$post");
    expect(source).not.toContain('AthenaSessionNotice');
    expect(source).not.toContain('SessionStatusPill');
  });
});
