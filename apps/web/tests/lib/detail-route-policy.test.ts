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

  it('keeps the Program shell on one aggregate read and defers secondary sections', () => {
    const source = readFileSync(join(root, details[2]), 'utf8');

    expect(source).toContain('programDetailAggregateDef');
    expect(source).not.toContain('fetchProgramDetail');
    expect(source).not.toContain('programRecordDef');
    expect(source).not.toContain('useOrgMembership');
    expect(source).toContain('enabled: ownerPickerOpen');
    expect(source).toContain("enabled: tab === 'updates'");
    expect(source).toContain('seedNavigationSnapshot(aggregate.snapshot)');
  });

  it('keeps the Initiative shell on its bounded aggregate instead of the legacy catch-all read', () => {
    const source = readFileSync(join(root, details[3]), 'utf8');

    expect(source).toContain('initiativeDetailAggregateDef');
    expect(source).not.toContain('initiativeDetailDef');
    expect(source).toContain("tab === 'updates'");
    expect(source).toContain("tab === 'resources'");
    expect(source).toContain('enabled: aggregate !== null');
    expect(source).toContain('enabled: ownerPickerOpen');
    expect(source).toContain('enabled: labelsPickerOpen');
    expect(source).toContain('seedNavigationSnapshot(aggregate.snapshot)');
    expect(source).toContain('Could not refresh this');
    expect(source).toContain('Could not load Initiative relationships.');
    expect(source).toContain('Could not load resources.');
  });

  it('keeps the Project shell on one aggregate read and leaves roster-backed controls dormant', () => {
    const source = readFileSync(join(root, details[1]), 'utf8');

    expect(source).toContain('projectDetailAggregateDef');
    expect(source).not.toContain('useProjectDetailPage');
    expect(source).not.toContain('fetchProjectDetail');
    expect(source).toContain('enabled: ownerPickerOpen');
    expect(source).toContain("enabled: aggregate !== null && tab === 'updates'");
    expect(source).toContain("enabled: aggregate !== null && tab === 'resources'");
    expect(source).toContain(
      "enabled: aggregate !== null && (tab === 'tasks' || repeatProjectOpen)",
    );
    expect(source).toContain('seedNavigationSnapshot(aggregate.snapshot)');
  });

  it('uses the bounded relationship endpoint after an Initiative relationship tab opens', () => {
    const source = readFileSync(join(root, 'src/lib/fetch-initiative-sections.ts'), 'utf8');

    expect(source).toContain('.relationships.$get');
    expect(source).not.toContain('.aggregate.$get');
  });
});
