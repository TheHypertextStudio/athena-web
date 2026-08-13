import { describe, expect, it } from 'vitest';

import { collectWorkspacePackages } from '../workspace';

describe('workspace package discovery', () => {
  it('includes domain packages in repository-wide policy scans', () => {
    const athena = collectWorkspacePackages().find(
      (workspacePackage) => workspacePackage.manifest.name === '@docket/athena',
    );

    expect(athena).toMatchObject({
      group: 'domains',
      manifestPath: expect.stringContaining('domains/athena/package.json'),
    });
  });
});
