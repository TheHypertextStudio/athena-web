/** Minimal trusted identity and private storage namespace represented by each registered client. */
export interface CacheIdentity {
  subject: string;
  namespace: string;
}

/**
 * Validate cache identities and derive the minimal public Worker binding.
 * @throws When identities or namespaces are missing, unsafe or duplicated.
 */
export function cacheClientNamespaces(clients: readonly CacheIdentity[]): Record<string, string> {
  if (clients.length === 0) throw new Error('Cache client registry must not be empty');
  const namespaces = new Set<string>();
  const identities = new Map<string, string>();
  for (const client of clients) {
    if (typeof client.subject !== 'string' || !/^\d+$/.test(client.subject))
      throw new Error('Cache subjects must be numeric Google IDs');
    if (
      typeof client.namespace !== 'string' ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(client.namespace) ||
      client.namespace.length > 64
    ) {
      throw new Error('Cache namespaces must be safe lowercase identifiers');
    }
    if (identities.has(client.subject) || namespaces.has(client.namespace)) {
      throw new Error('Cache identities and namespaces must be unique');
    }
    identities.set(client.subject, client.namespace);
    namespaces.add(client.namespace);
  }
  return Object.fromEntries(identities);
}

/** Parse and validate the minimal runtime identity map without mutating shared bindings. */
export function parseCacheClients(serialized: string): Record<string, string> {
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Cache clients must be an identity map');
  }
  const entries: CacheIdentity[] = [];
  for (const [subject, namespace] of Object.entries(value)) {
    if (typeof namespace !== 'string') throw new Error('Cache namespaces must be strings');
    entries.push({ subject, namespace });
  }
  return cacheClientNamespaces(entries);
}
