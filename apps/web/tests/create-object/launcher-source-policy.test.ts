/**
 * Source policy for the global object-creation cutover.
 *
 * @remarks
 * The rendered command and composer tests cover request and completion behavior. This policy test
 * protects the architectural half of the cutover: supported pages may launch the global provider,
 * but may not grow a second dialog mount or restore the removed URL-trigger bridge.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(import.meta.dirname, '../..');

const LAUNCHERS = [
  'src/app/(app)/orgs/[orgId]/tasks/org-tasks-client.tsx',
  'src/app/(app)/orgs/[orgId]/projects/projects-client.tsx',
  'src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx',
  'src/app/(app)/orgs/[orgId]/programs/programs-client.tsx',
  'src/app/(app)/orgs/[orgId]/my-work/my-work-client.tsx',
  'src/app/(app)/orgs/[orgId]/teams/teams-client.tsx',
  'src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx',
  'src/components/programs/program-projects-panel.tsx',
] as const;

/** Read a web source file relative to the workspace package. */
function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), 'utf8');
}

describe('global creation launcher source policy', () => {
  it.each(LAUNCHERS)('%s has no page-owned supported-kind dialog', (path) => {
    const text = source(path);
    expect(text).not.toMatch(
      /import\s+\{\s*Create(?:Task|Project|Initiative|Program|Team)Dialog\s*\}/,
    );
    expect(text).not.toMatch(/<Create(?:Task|Project|Initiative|Program|Team)Dialog\b/);
  });

  it('has no live URL bridge for supported-kind creation', () => {
    const sourceRoot = resolve(WEB_ROOT, 'src');
    const allLaunchers = [...LAUNCHERS, 'src/components/command-palette/use-command-actions.ts']
      .map(source)
      .join('\n');

    expect(allLaunchers).not.toContain('useComposeRequest');
    expect(allLaunchers).not.toContain('composeHref');
    expect(() =>
      readFileSync(resolve(sourceRoot, 'components/composer/use-compose-param.ts')),
    ).toThrow();
  });

  it.each([
    [
      'src/app/(app)/orgs/[orgId]/tasks/org-tasks-client.tsx',
      "kind: 'task'",
      "sameWorkspaceCompletion: 'open'",
    ],
    [
      'src/app/(app)/orgs/[orgId]/projects/projects-client.tsx',
      "kind: 'project'",
      "sameWorkspaceCompletion: 'open'",
    ],
    [
      'src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx',
      "kind: 'initiative'",
      "sameWorkspaceCompletion: 'open'",
    ],
    [
      'src/app/(app)/orgs/[orgId]/programs/programs-client.tsx',
      "kind: 'program'",
      "sameWorkspaceCompletion: 'open'",
    ],
    [
      'src/app/(app)/orgs/[orgId]/my-work/my-work-client.tsx',
      "kind: 'task'",
      "sameWorkspaceCompletion: 'stay'",
    ],
    [
      'src/app/(app)/orgs/[orgId]/teams/teams-client.tsx',
      "kind: 'team'",
      'initialWorkspaceId: orgId',
    ],
    [
      'src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx',
      'defaultProjectId: projectId',
      "sameWorkspaceCompletion: 'stay'",
    ],
    [
      'src/components/programs/program-projects-panel.tsx',
      'defaultProgramId: programId',
      "sameWorkspaceCompletion: 'stay'",
    ],
  ] as const)('%s carries its fixed context and completion request', (path, first, second) => {
    const text = source(path);
    expect(text).toContain('openCreate({');
    expect(text).toContain('initialWorkspaceId: orgId');
    expect(text).toContain(first);
    expect(text).toContain(second);
  });
});
