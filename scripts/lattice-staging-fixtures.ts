import type { RuntimeSecretBindings } from './lattice-acceptance-report';

/** The two audited synthetic proposals; these identities are never operator inputs. */
export const stagingFixtures = [
  {
    workId: 'work_01M3RAGV53DR0BBBBQ1BZKCBBZ',
    delegationId: '01M3RAGV53PTC8NDEVY87MFR91',
    sessionId: '01M3RAGVAJVR9D0KN12PJPA20N',
    taskId: '01M3RAGBM81NFYQY335M9890F7',
    activityId: '01M3RAQP14TCR044NE01E1SK8G',
  },
  {
    workId: 'work_01M3RESNA78DAVDT7THMJY61CF',
    delegationId: '01M3RESNA7DHV6MYBJQQ9CF7VZ',
    sessionId: '01M3RESNFPFTMWRYW0B3ECX108',
    taskId: '01M3RESKGXV747V6Q5D9GFAY8E',
    activityId: '01M3RF7P42G798JW7RDCPJ1ZZ8',
  },
] as const;

/** Required identities and lifecycle state before rejecting a fixed staging proposal. */
export interface StagingFixtureRow {
  workId: string;
  delegationId: string;
  sessionId: string;
  taskId: string;
  activityId: string;
  ownerUserId: string;
  ownerEmail: string;
  organizationId: string;
  executionSurface: string;
  status: string;
  approvalStatus: string | null;
  type: string;
}

/**
 * Enforce synthetic ownership, exact fixture identity, and a rejectable or already rejected state.
 * @throws When any boundary or proposal identity differs from the audited fixture.
 */
export function assertStagingFixture(row: StagingFixtureRow): void {
  const fixture = stagingFixtures.find((f) => f.workId === row.workId);
  const identityMatches =
    fixture &&
    Object.entries(fixture).every(([key, value]) => row[key as keyof StagingFixtureRow] === value);
  const stateMatches =
    (row.status === 'proposed' && row.approvalStatus === 'proposed') ||
    (row.status === 'canceled' && row.approvalStatus === 'rejected');
  if (
    !identityMatches ||
    !stateMatches ||
    row.type !== 'action' ||
    row.executionSurface !== 'lattice' ||
    row.ownerUserId !== '01M3R6TXMS0GKF6CMT7R67S2XA' ||
    row.ownerEmail !== 'lattice-canary-01m3r6txms0gkf6cmt7r67s2xa@example.invalid' ||
    row.organizationId !== '01M3RAG9W3VTHE2E34FY7Z078M'
  ) {
    throw new Error('Unexpected staging fixture');
  }
}

/** Require isolated, named staging database, encryption, and mail secrets before any mutation. */
export function assertStagingBindings(bindings: RuntimeSecretBindings['bindings']): void {
  const expected = {
    DATABASE_URL: 'docket-staging-database-url',
    CREDENTIALS_ENCRYPTION_KEY: 'docket-staging-credentials-encryption-key',
    RESEND_API_KEY: 'docket-staging-resend-api-key',
    MAIL_FROM: 'docket-staging-mail-from',
    BETTER_AUTH_SECRET: 'docket-staging-auth-secret',
  };
  for (const [environmentName, secretName] of Object.entries(expected)) {
    if (bindings.find((b) => b.environmentName === environmentName)?.secretName !== secretName) {
      throw new Error('Unexpected staging secret binding');
    }
  }
}

function databaseFailureCode(error: object): string | null {
  const cause = 'cause' in error ? error.cause : error;
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return null;
  const code = String(cause.code);
  return /^(08|22|23|28|42|53|54|55|57|58|XX)[0-9A-Z]{3}$/.test(code) ? `database_${code}` : null;
}

function guardFailureCode(error: object): string | null {
  if (!(error instanceof Error)) return null;
  const guards: Record<string, string> = {
    'Missing staging fixtures': 'missing_fixtures',
    'Unexpected staging fixture': 'fixture_guard',
    'Staging rejection postcondition failed': 'rejection_postcondition',
    'Staging fixture disappeared': 'fixture_disappeared',
  };
  return guards[error.message] ?? null;
}

function connectionFailureCode(error: object): string | null {
  if (!('code' in error)) return null;
  const code = String(error.code);
  return [
    'ENOTFOUND',
    'ECONNRESET',
    'ECONNREFUSED',
    'CONNECT_TIMEOUT',
    'CONNECTION_CLOSED',
    'UNDEFINED_VALUE',
    'INVALID_URL',
  ].includes(code)
    ? `connection_${code.toLowerCase()}`
    : null;
}

/** Reduce provider failures to stable codes without exposing subprocess output or secrets. */
export function providerFailureCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'provider_error';
  if ('code' in error && error.code === 'ETIMEDOUT') return 'timeout';
  const knownCode =
    connectionFailureCode(error) ?? databaseFailureCode(error) ?? guardFailureCode(error);
  if (knownCode) return knownCode;
  const stderr = 'stderr' in error ? error.stderr : null;
  const message = Buffer.isBuffer(stderr)
    ? stderr.toString('utf8')
    : typeof stderr === 'string'
      ? stderr
      : '';
  return /PERMISSION_DENIED|Permission.*denied|does not have permission/i.test(message)
    ? 'permission_denied'
    : 'provider_error';
}
