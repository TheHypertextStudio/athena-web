import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../..');
const details = [
  'src/app/(app)/orgs/[orgId]/tasks/[taskId]/task-detail-client.tsx',
  'src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx',
  'src/app/(app)/orgs/[orgId]/programs/[programId]/program-detail-client.tsx',
  'src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx',
] as const;

describe('detail route ownership', () => {
  it.each(details)('%s reads only its generated typed route variant', (file) => {
    const source = readFileSync(join(root, file), 'utf8');

    expect(source).not.toContain('useAppParams');
    expect(source).toContain('useTypedRoute');
    expect(source).not.toContain("from 'next/navigation'");
  });
});
