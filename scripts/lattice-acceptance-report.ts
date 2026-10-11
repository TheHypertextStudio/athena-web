/** Fixed evidence targets; an audit never accepts arbitrary record IDs. */
export function acceptanceTargets(target: string): { assignmentIds: string[]; workIds: string[] } {
  if (target === 'production') {
    return {
      assignmentIds: ['01M41GY6TZ6Z6AF87E2RS56PRB', '01M41KQSTHHXHKV61ZT4DXRW8K'],
      workIds: [],
    };
  }
  if (target === 'staging') {
    return {
      assignmentIds: [],
      workIds: ['work_01M3RAGV53DR0BBBBQ1BZKCBBZ', 'work_01M3RESNA78DAVDT7THMJY61CF'],
    };
  }
  throw new Error('Unknown audit target');
}

/** Treat untrusted JSON as an object without accepting arrays or null. */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isoOrNull(milliseconds: number): string | null {
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function tokenMetadata(token: unknown): { subject: string | null; tokenExpiresAt: string | null } {
  const empty = { subject: null, tokenExpiresAt: null };
  if (typeof token !== 'string' || token.split('.').length !== 3) return empty;
  try {
    const claims = record(
      JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()),
    );
    return {
      subject: stringOrNull(claims['sub']),
      tokenExpiresAt: typeof claims['exp'] === 'number' ? isoOrNull(claims['exp'] * 1000) : null,
    };
  } catch {
    return empty;
  }
}

/** Credential metadata, never bearer tokens. Decoded claims are not signature verification. */
export interface CredentialTiming {
  clientId: string | null;
  obtainedAt: string | null;
  expiresInSeconds: number | null;
  expiresAt: string | null;
  scope: string | null;
  refreshAvailable: boolean;
  subject: string | null;
  tokenExpiresAt: string | null;
}

/**
 * Project only timing and identity metadata from an approved credential.
 * @throws When the stored value is not an approved OAuth credential.
 */
export function credentialTiming(value: unknown): CredentialTiming {
  const input = record(value);
  if (input['kind'] !== 'lattice_oauth') throw new Error('No approved OAuth credential');
  const obtainedAt = stringOrNull(input['obtainedAt']);
  const expiresInSeconds =
    typeof input['expiresInSeconds'] === 'number' && Number.isFinite(input['expiresInSeconds'])
      ? input['expiresInSeconds']
      : null;
  return {
    clientId: stringOrNull(input['clientId']),
    obtainedAt,
    expiresInSeconds,
    expiresAt:
      obtainedAt !== null && expiresInSeconds !== null
        ? isoOrNull(Date.parse(obtainedAt) + expiresInSeconds * 1000)
        : null,
    scope: stringOrNull(input['scope']),
    refreshAvailable: typeof input['refreshToken'] === 'string' && input['refreshToken'].length > 0,
    ...tokenMetadata(input['accessToken']),
  };
}

/** Runtime references that can be recorded without revealing environment values. */
export interface RuntimeSecretBindings {
  revision: string | null;
  url: string | null;
  bindings: { environmentName: string; secretName: string; version: string }[];
}

function secretBinding(value: unknown): RuntimeSecretBindings['bindings'] {
  const input = record(value);
  const reference = record(record(input['valueFrom'])['secretKeyRef']);
  if (
    typeof input['name'] !== 'string' ||
    typeof reference['name'] !== 'string' ||
    typeof reference['key'] !== 'string'
  )
    return [];
  return [
    { environmentName: input['name'], secretName: reference['name'], version: reference['key'] },
  ];
}

/** Extract deployed secret references while discarding all literal environment values. */
export function runtimeSecretBindings(value: unknown): RuntimeSecretBindings {
  const input = record(value);
  const status = record(input['status']);
  const containers = record(record(record(input['spec'])['template'])['spec'])['containers'];
  const container = record(Array.isArray(containers) ? containers[0] : null);
  const environment = Array.isArray(container['env']) ? container['env'] : [];
  return {
    revision: stringOrNull(status['latestReadyRevisionName']),
    url: stringOrNull(status['url']),
    bindings: environment.flatMap(secretBinding),
  };
}

/**
 * Select the revision actually receiving all traffic, including an explicit older pin.
 * @throws When traffic is split or the serving revision cannot be identified.
 */
export function servingRevision(value: unknown): string {
  const status = record(record(value)['status']);
  const traffic = status['traffic'];
  if (!Array.isArray(traffic)) throw new Error('Serving revision unavailable');
  const receiving = traffic.map(record).filter((entry) => Number(entry['percent']) > 0);
  const route = receiving[0];
  if (receiving.length !== 1 || !route || Number(route['percent']) !== 100) {
    throw new Error('Ambiguous serving revisions');
  }
  const revision = stringOrNull(route['revisionName']);
  if (!revision) throw new Error('Serving revision unavailable');
  return revision;
}

function requestPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

/** Project request timing/status without payloads, headers, or URL query credentials. */
export function requestLogMetadata(value: unknown): Record<string, string | number | null>[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry: unknown) => {
    const row = record(entry);
    const request = record(row['httpRequest']);
    const labels = record(record(row['resource'])['labels']);
    return {
      timestamp: stringOrNull(row['timestamp']),
      insertId: stringOrNull(row['insertId']),
      trace: stringOrNull(row['trace']),
      revision: stringOrNull(labels['revision_name']),
      method: stringOrNull(request['requestMethod']),
      status: typeof request['status'] === 'number' ? request['status'] : null,
      latency: stringOrNull(request['latency']),
      path: requestPath(request['requestUrl']),
    };
  });
}
