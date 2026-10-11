/** Validated request-routing inputs; separate from public build identity and credentials. */
export interface WorkerRuntimeConfig {
  readonly apiOrigin: string;
  readonly appOrigin: string;
  readonly appHostname: string;
  readonly briefHostname: string | undefined;
  readonly recoveryHostname: string | undefined;
  readonly legacyRpHostname: string | undefined;
  readonly local: boolean;
}

/** Narrow an untrusted configuration record without reading ambient environment. */
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workers routing configuration must be an object');
  }
  return value as Record<string, unknown>;
}

/** Read a bare normalized hostname; these checks do not establish public DNS ownership. */
function hostname(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
  const parsed = new URL(`https://${value}`);
  if (parsed.hostname !== value || parsed.origin !== `https://${value}` || !value.includes('.')) {
    throw new Error(`${name} must be a bare lower-case hostname`);
  }
  return value;
}

/** Reject known nonpublic host syntax; provider public-fetch restrictions remain necessary. */
function assertPublicHostname(host: string): void {
  if (
    host.startsWith('[') ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host) ||
    host.endsWith('.home.arpa')
  ) {
    throw new Error('Provider routing requires public hostnames');
  }
}

/** Read an origin without credentials, path, query or fragment. */
function origin(value: unknown, name: string, local: boolean, localHost: string): URL {
  if (typeof value !== 'string') throw new Error(`${name} is required`);
  const parsed = new URL(value);
  if (parsed.origin !== value || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    throw new Error(`${name} must be an absolute origin`);
  }
  if (local) {
    if (parsed.hostname !== localHost) throw new Error('Local routing requires isolated localhost');
  } else {
    if (parsed.protocol !== 'https:') throw new Error('Provider routing requires HTTPS');
    assertPublicHostname(hostname(parsed.hostname, name));
  }
  return parsed;
}

/** Parse optional host metadata without treating malformed values as absent. */
function optionalHostname(value: unknown, name: string): string | undefined {
  return value === undefined || value === '' ? undefined : hostname(value, name);
}

/** Keep explicit local acceptance separate from declared provider environments. */
function localMode(env: Record<string, unknown>): boolean {
  if (env['STUDIO_DEPLOYMENT_ENV'] !== 'staging' && env['STUDIO_DEPLOYMENT_ENV'] !== 'production') {
    throw new Error('Workers routing requires a declared deployment environment');
  }
  const local = env['DOCKET_LOCAL_ACCEPTANCE'] === '1';
  if (env['DOCKET_LOCAL_ACCEPTANCE'] !== undefined && !local) {
    throw new Error('Invalid local acceptance mode');
  }
  if (local && env['STUDIO_DEPLOYMENT_ENV'] !== 'staging') {
    throw new Error('Local acceptance cannot select production');
  }
  return local;
}

/** Preserve production Publishing readiness and distinct brief/API/application hosts. */
function assertBriefHost(
  brief: string | undefined,
  app: URL,
  api: URL,
  env: Record<string, unknown>,
): void {
  if (!brief && env['STUDIO_DEPLOYMENT_ENV'] === 'production') {
    throw new Error('Production requires PUBLIC_BRIEF_HOST');
  }
  if (brief === app.hostname || brief === api.hostname) {
    throw new Error('Brief, API and application hosts must differ');
  }
}

/**
 * Validate routing inputs for the current request; missing provider config never falls back.
 * @param value The explicit native Worker bindings.
 * @returns Environment-local API and host configuration.
 * @throws For absent, malformed, recursive or known nonpublic provider inputs.
 */
export function readWorkerRuntimeConfig(value: unknown): WorkerRuntimeConfig {
  const env = record(value);
  const local = localMode(env);
  const app = origin(env['WEB_URL'], 'WEB_URL', local, 'docket.localhost');
  const api = origin(env['API_URL'], 'API_URL', local, 'api.docket.localhost');
  if (api.origin === app.origin) throw new Error('API and app origins must differ');
  const rp = hostname(env['BETTER_AUTH_PASSKEY_RP_ID'], 'BETTER_AUTH_PASSKEY_RP_ID');
  const briefHostname = optionalHostname(env['PUBLIC_BRIEF_HOST'], 'PUBLIC_BRIEF_HOST');
  const legacyRpHostname = optionalHostname(
    env['BETTER_AUTH_PASSKEY_LEGACY_RP_ID'],
    'BETTER_AUTH_PASSKEY_LEGACY_RP_ID',
  );
  assertBriefHost(briefHostname, app, api, env);
  if (!local) {
    for (const host of [rp, briefHostname, legacyRpHostname]) {
      if (host !== undefined) assertPublicHostname(host);
    }
  }
  return {
    apiOrigin: api.origin,
    appOrigin: app.origin,
    appHostname: app.hostname,
    briefHostname,
    recoveryHostname: rp === app.hostname ? undefined : `docket.${rp}`,
    legacyRpHostname,
    local,
  };
}

/** Match only the existing canonical, transitional and explicit local app-host semantics. */
export function isWorkerApplicationHost(host: string, config: WorkerRuntimeConfig): boolean {
  return (
    host === config.appHostname ||
    host === config.recoveryHostname ||
    (config.local && (host === 'docket.localhost' || host.endsWith('.docket.localhost')))
  );
}
