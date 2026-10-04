import { describe, expect, it } from 'vitest';
import {
  assertStagingFixture,
  stagingFixtures,
  assertStagingBindings,
  providerFailureCode,
} from '../../scripts/lattice-staging-fixtures';

describe('staging cleanup authority', () => {
  it('classifies actionable failures without returning raw subprocess credentials', () => {
    expect(providerFailureCode({ stderr: Buffer.from('PERMISSION_DENIED secret=SECRET') })).toBe(
      'permission_denied',
    );
    expect(providerFailureCode({ code: 'ETIMEDOUT', stderr: 'SECRET' })).toBe('timeout');
    expect(providerFailureCode(new Error('SECRET'))).toBe('provider_error');
  });
  const row = {
    ...stagingFixtures[0],
    ownerUserId: '01M3R6TXMS0GKF6CMT7R67S2XA',
    ownerEmail: 'docket-lattice-proof-20260930@example.invalid',
    organizationId: '01M3RAG9W3VTHE2E34FY7Z078M',
    executionSurface: 'lattice',
    status: 'proposed',
    approvalStatus: 'proposed',
    type: 'action',
  };
  it('accepts only the exact synthetic owner and immutable fixture identities', () => {
    expect(() => {
      assertStagingFixture(row);
    }).not.toThrow();
    for (const changed of [
      { ownerUserId: 'production-owner' },
      { ownerEmail: 'other@example.invalid' },
      { organizationId: 'production-org' },
      { activityId: 'another-action' },
      { taskId: 'real-task' },
      { executionSurface: 'hosted' },
      { status: 'completed' },
      { approvalStatus: 'approved' },
    ]) {
      expect(() => {
        assertStagingFixture({ ...row, ...changed });
      }).toThrow('Unexpected staging fixture');
    }
  });
  it('permits an idempotent already-rejected result but no mixed terminal state', () => {
    expect(() => {
      assertStagingFixture({ ...row, status: 'canceled', approvalStatus: 'rejected' });
    }).not.toThrow();
    expect(() => {
      assertStagingFixture({ ...row, status: 'canceled' });
    }).toThrow('Unexpected staging fixture');
  });
  it('refuses a production secret or a reused staging database/encryption reference', () => {
    const bindings = [
      {
        environmentName: 'DATABASE_URL',
        secretName: 'docket-staging-database-url',
        version: 'latest',
      },
      {
        environmentName: 'CREDENTIALS_ENCRYPTION_KEY',
        secretName: 'docket-staging-credentials-encryption-key',
        version: 'latest',
      },
      {
        environmentName: 'RESEND_API_KEY',
        secretName: 'docket-staging-resend-api-key',
        version: 'latest',
      },
    ];
    expect(() => {
      assertStagingBindings(bindings);
    }).not.toThrow();
    expect(() => {
      assertStagingBindings(bindings.map((b) => ({ ...b, secretName: 'docket-resend-api-key' })));
    }).toThrow('Unexpected staging secret binding');
    expect(() => {
      assertStagingBindings([]);
    }).toThrow('Unexpected staging secret binding');
  });
});
