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

/** Resource reads live in the panel mounted only by the active Resources tab. */
function expectDeferredResources(source: string, subjectType: 'project' | 'initiative'): void {
  expect(source).toMatch(
    /<TabPanel\s+hidden=\{!\(tab === 'resources'\)\}[^>]*value="resources"[^>]*render=\{\(\) => \([\s\S]*?<WorkResourcesPanel/,
  );
  const panel = /<WorkResourcesPanel\b[^>]*\/>/.exec(source)?.[0];
  expect(panel).toContain('orgId={orgId}');
  expect(panel).toContain(`subjectType="${subjectType}"`);
  expect(panel).toContain(`subjectId={${subjectType}Id}`);
  const aggregateGuard = source.indexOf(
    `if (!${subjectType === 'project' ? 'project' : 'detail'}) return`,
  );
  expect(aggregateGuard).toBeGreaterThan(-1);
  expect(aggregateGuard).toBeLessThan(source.indexOf('<WorkResourcesPanel'));
  // The shared primitive skips render callbacks for hidden panels, keeping their queries dormant.
  const tabs = readFileSync(join(root, '../../packages/ui/src/primitives/tabs.tsx'), 'utf8');
  expect(tabs).toContain('render ? (props.hidden ? null : render()) : children');
  const resources = readFileSync(
    join(root, 'src/components/entity-detail/work-resources-panel.tsx'),
    'utf8',
  );
  expect(resources).toContain('useWorkResources(orgId, subjectType, subjectId)');
  expect(resources).toContain('error={data.error}');
  expect(resources).toContain('loadFailure={data.loadFailure}');
  expect(resources).toContain('onRetry={data.retry}');
  const hook = readFileSync(join(root, 'src/lib/use-work-resources.ts'), 'utf8');
  expect(hook).toContain("['work-resources'][':subjectType'][':subjectId']");
  expect(hook).toContain('fetchAllCursorPages((cursor) =>');
  expect(hook).toContain("query: { limit: '100', ...(cursor ? { cursor } : {}) }");
  expect(hook).toContain('Could not load resources.');
  expect(hook).toContain('loadFailure: list.error');
  expect(hook).toContain('void list.refetch()');
  const resourceTab = readFileSync(
    join(root, 'src/components/entity-detail/resources-tab.tsx'),
    'utf8',
  );
  expect(resourceTab).toContain(
    '<ResourceFailure message={error} failure={loadFailure} onRetry={onRetry} />',
  );
  expect(resourceTab).toContain('<LoadFailure title="Resources" error={failure} onRetry={onRetry}');
}

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
    expect(source).toContain('relationshipsQ.isError');
    expect(source).toContain('PartialLoadBanner');
    expectDeferredResources(source, 'initiative');
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
    expectDeferredResources(source, 'project');
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

  it('keeps Task identity on its aggregate and reads no organization roster', () => {
    const source = readFileSync(join(root, 'src/lib/use-task-detail.ts'), 'utf8');

    expect(source).toContain('taskDetailAggregateDef');
    expect(source).toContain('defaultView.task');
    // Rosters belong to `useTaskRosters`, which keeps each dormant until its picker opens or the
    // task holds a value from it.
    expect(source).not.toContain('.members.$get');
    expect(source).not.toContain('.projects.$get');
    expect(source).not.toContain('.roles.$get');
  });

  it('never renders a partial navigation snapshot as an entity document', () => {
    for (const file of details) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source).not.toContain('EntityDetailSnapshot');
      expect(source).not.toContain("aggregateState === 'snapshot'");
    }
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
