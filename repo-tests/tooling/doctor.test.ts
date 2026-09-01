/**
 * The drift diagnosis, against the states that have actually broken production.
 *
 * @remarks
 * The cloud reads are injected, so every case here is a real observation shape rather than a
 * mock of one — including the two failures this session hit: a repository variable that was never
 * created, and an API left running as the project's default compute account.
 */
import { describe, expect, it } from 'vitest';

import {
  API_RUNTIME_ORG_ROLE,
  API_RUNTIME_SA_ROLES,
  AR_REPO,
  DEPLOY_SA_ROLES,
  REQUIRED_GCP_APIS,
  WIF_POOL,
  WIF_PROVIDER,
} from '../../scripts/bootstrap';
import { diagnose, type Observation } from '../../scripts/doctor';

const PROJECT = 'athena-test';
const DEPLOY_SA = `docket-deploy@${PROJECT}.iam.gserviceaccount.com`;
const RUNTIME_SA = `docket-api@${PROJECT}.iam.gserviceaccount.com`;

/** A fully provisioned project, as bootstrap leaves it. */
function healthy(overrides: Partial<Observation> = {}): Observation {
  return {
    project: PROJECT,
    enabledApis: [...REQUIRED_GCP_APIS],
    serviceAccounts: [DEPLOY_SA, RUNTIME_SA],
    projectRoles: { [DEPLOY_SA]: [...DEPLOY_SA_ROLES], [RUNTIME_SA]: [...API_RUNTIME_SA_ROLES] },
    orgRoles: [API_RUNTIME_ORG_ROLE],
    artifactRepos: [AR_REPO],
    wifPools: [WIF_POOL],
    wifProviders: [WIF_PROVIDER],
    repoVars: [
      'GCP_PROJECT_ID',
      'GCP_REGION',
      'GCP_SERVICE_ACCOUNT',
      'GCP_API_RUNTIME_SERVICE_ACCOUNT',
      'GCP_WIF_PROVIDER',
    ],
    environmentVars: [
      'API_URL',
      'WEB_URL',
      'ADMIN_URL',
      'PASSKEY_RP_ID',
      'BETTER_AUTH_ALLOWED_HOSTS',
      'GOOGLE_OAUTH_PUBLIC',
      'API_SECRET_BINDINGS',
    ],
    apiRuntimeServiceAccount: RUNTIME_SA,
    ...overrides,
  };
}

/** The failing check of a given name. */
function failure(observation: Observation, name: string) {
  return diagnose(observation).checks.find(
    (check) => check.name === name && check.status === 'fail',
  );
}

/** The check of a given name, whatever its status. */
function check(observation: Observation, name: string) {
  return diagnose(observation).checks.find((c) => c.name === name);
}

describe('diagnose', () => {
  it('passes a fully provisioned project', () => {
    const report = diagnose(healthy());

    expect(report.passed).toBe(true);
    expect(report.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('reports a repository variable that was never created', () => {
    // Exactly the drift that broke a deploy: the variable only bootstrap creates was absent on an
    // already-bootstrapped project, so the workflow wrote an empty value.
    const check = failure(
      healthy({ repoVars: ['GCP_PROJECT_ID', 'GCP_REGION', 'GCP_SERVICE_ACCOUNT'] }),
      'Repository variables',
    );

    expect(check?.detail).toContain('GCP_API_RUNTIME_SERVICE_ACCOUNT');
  });

  it('reports an API still running as the default compute account', () => {
    // Nothing else would say so: the deploy passes --service-account only when the variable
    // exists, so an unset variable silently leaves the shared, broadly privileged account in place.
    const check = failure(
      healthy({ apiRuntimeServiceAccount: '123-compute@developer.gserviceaccount.com' }),
      'API runs as its own account',
    );

    expect(check?.detail).toContain('expected');
  });

  it('reports a disabled API by name', () => {
    const check = failure(
      healthy({
        enabledApis: REQUIRED_GCP_APIS.filter((a) => a !== 'cloudidentity.googleapis.com'),
      }),
      'APIs enabled',
    );

    expect(check?.detail).toContain('cloudidentity.googleapis.com');
  });

  it('reports the org role operator SSO needs, which is granted outside the project', () => {
    expect(failure(healthy({ orgRoles: [] }), 'Runtime account org role')).toBeDefined();
  });

  it('reports a missing role rather than a missing account when the account exists', () => {
    const observation = healthy({
      projectRoles: {
        [DEPLOY_SA]: ['roles/run.developer'],
        [RUNTIME_SA]: [...API_RUNTIME_SA_ROLES],
      },
    });

    expect(failure(observation, 'Service accounts')).toBeUndefined();
    expect(failure(observation, 'Deploy account roles')?.detail).toContain('artifactregistry');
  });

  it('reports a production-environment variable separately from a repository one', () => {
    // The scope trap: an environment variable shadows a repository one of the same name, so the
    // two sets have to be reported apart or a value looks present while the deploy reads another.
    const check = failure(
      healthy({ environmentVars: ['API_URL', 'WEB_URL'] }),
      'Production environment variables',
    );

    expect(check?.detail).toContain('API_SECRET_BINDINGS');
  });

  it('fails the whole report when any single check fails', () => {
    expect(diagnose(healthy({ artifactRepos: [] })).passed).toBe(false);
  });

  it('reports an unreadable boundary as unknown, not as everything being absent', () => {
    // An expired `gh` token made every variable look missing. Reporting that as drift would block
    // a deploy while naming the wrong cause, so it is neither a pass nor a failure.
    const report = diagnose(healthy({ repoVars: null, environmentVars: null }));

    expect(check(healthy({ repoVars: null }), 'Repository variables')?.status).toBe('unknown');
    expect(report.passed).toBe(true);
  });

  it('reports an unreadable Cloud Run separately from a wrong service account', () => {
    expect(
      check(healthy({ apiRuntimeServiceAccount: null }), 'API runs as its own account')?.status,
    ).toBe('unknown');
  });
});
