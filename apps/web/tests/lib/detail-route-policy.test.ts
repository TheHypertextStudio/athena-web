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
    expect(source).toContain("enabled: tab === 'overview' || tab === 'updates'");
    expect(source).toContain('seedNavigationSnapshot(aggregate.snapshot)');
  });

  it('keeps the Initiative shell on its bounded aggregate instead of the legacy catch-all read', () => {
    const source = readFileSync(join(root, details[3]), 'utf8');

    expect(source).toContain('initiativeDetailAggregateDef');
    expect(source).not.toContain('initiativeDetailDef');
    expect(source).toContain("tab === 'overview' || tab === 'updates'");
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
    expect(source).toContain(
      "enabled: aggregate !== null && (tab === 'overview' || tab === 'updates')",
    );
    expect(source).toContain("enabled: aggregate !== null && tab === 'resources'");
    expect(source).toContain(
      "enabled: aggregate !== null && (tab === 'overview' || tab === 'tasks' || repeatProjectOpen)",
    );
    expect(source).toContain('seedNavigationSnapshot(aggregate.snapshot)');
  });

  it('uses the bounded relationship endpoint after an Initiative relationship tab opens', () => {
    const source = readFileSync(join(root, 'src/lib/fetch-initiative-sections.ts'), 'utf8');

    expect(source).toContain('.relationships.$get');
    expect(source).not.toContain('.aggregate.$get');
  });

  it('keeps Task identity on its aggregate while pickers and activity stay dormant', () => {
    const source = readFileSync(join(root, 'src/lib/use-task-detail.ts'), 'utf8');

    expect(source).toContain('taskDetailAggregateDef');
    expect(source).toContain('defaultView.task');
    expect(source).toContain('enabled: options.projectsOpen ?? false');
    expect(source).toContain('enabled: options.programsOpen ?? false');
    expect(source).toContain('enabled: options.membersOpen ?? false');
    expect(source).toContain('enabled: options.milestonesOpen ?? false');
    expect(source).toContain('enabled: options.cyclesOpen ?? false');
    expect(source).toContain('enabled: options.activityOpen ?? false');
  });

  it('defers task-linked request owners until the user asks for them', () => {
    const source = readFileSync(join(root, details[0]), 'utf8');

    expect(source).toContain('const [linkedContentOpen, setLinkedContentOpen] = useState(false)');
    expect(source).toContain('linkedContentOpen ? <TaskRepeatingWorkBacklink');
    expect(source).toContain('linkedContentOpen ? (');
    expect(source).toContain('Load attachments and dependency map');
  });

  it('never renders a partial navigation snapshot as an entity document', () => {
    for (const file of details) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source).not.toContain('EntityDetailSnapshot');
      expect(source).not.toContain("aggregateState === 'snapshot'");
    }
  });

  it('warms the exact aggregate query before opening an entity detail route', () => {
    const source = readFileSync(join(root, 'src/components/docket-link.tsx'), 'utf8');

    expect(source).toContain('usePrefetchApi');
    expect(source).toContain('prefetchDetailAggregate');
    expect(source).toContain('taskDetailAggregateDef');
    expect(source).toContain('projectDetailAggregateDef');
    expect(source).toContain('programDetailAggregateDef');
    expect(source).toContain('initiativeDetailAggregateDef');
  });

  it('gives every entity route a designed loading boundary before client code mounts', () => {
    const loadingEntries = [
      ['tasks/[taskId]/loading.tsx', 'TaskDetailLoading'],
      ['projects/[projectId]/loading.tsx', 'EntityDetailSkeleton'],
      ['programs/[programId]/loading.tsx', 'EntityDetailSkeleton'],
      ['initiatives/[initiativeId]/loading.tsx', 'EntityDetailSkeleton'],
    ] as const;

    for (const [file, component] of loadingEntries) {
      const source = readFileSync(join(root, `src/app/(app)/orgs/[orgId]/${file}`), 'utf8');
      expect(source).toContain(component);
    }
  });
});
