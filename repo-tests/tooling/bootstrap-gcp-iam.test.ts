import { describe, expect, it } from 'vitest';

import { API_RUNTIME_SA_ROLES, grantProjectRoles } from '../../scripts/bootstrap/gcp-iam';

describe('bootstrap GCP IAM grants', () => {
  it('grants every runtime role to the dedicated service account', () => {
    const commands: string[] = [];
    const reports: string[] = [];

    grantProjectRoles(
      'athena-services',
      'docket-api@athena-services.iam.gserviceaccount.com',
      API_RUNTIME_SA_ROLES,
      (command) => commands.push(command),
      (message) => reports.push(message),
    );

    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('--role="roles/secretmanager.secretAccessor"');
    expect(commands[1]).toContain('--role="roles/aiplatform.user"');
    expect(reports).toEqual(API_RUNTIME_SA_ROLES);
  });
});
