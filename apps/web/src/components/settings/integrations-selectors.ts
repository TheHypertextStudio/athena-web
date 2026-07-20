/**
 * `settings` — pure derivations over the integrations/identities data.
 *
 * @remarks
 * These are the data layer's selectors: total functions from server data to the shapes the
 * Connections surface renders, with no React, no fetching, and no side effects. Keeping them here
 * (rather than inline in a component or hook) makes each independently testable and lets the
 * controller hook read as orchestration rather than arithmetic.
 */
import type {
  IdentityOut,
  IntegrationDirectoryProvider,
  IntegrationOut,
  IntegrationPattern,
} from '@docket/types';

/**
 * Group the directory's providers of one connect pattern by category, in first-seen order,
 * keeping only those a feature should show (`isVisible`).
 *
 * @remarks
 * The shared grouping both Connections (`connector`) and Import (`migration`) run before each
 * assembles its own rows — the only difference between them is the pattern they pass.
 */
export function groupDirectoryByCategory(
  directory: readonly IntegrationDirectoryProvider[],
  pattern: IntegrationPattern,
  isVisible: (provider: string) => boolean,
): readonly { category: string; providers: readonly IntegrationDirectoryProvider[] }[] {
  const order: string[] = [];
  const map = new Map<string, IntegrationDirectoryProvider[]>();
  for (const provider of directory) {
    if (provider.pattern !== pattern) continue;
    if (!isVisible(provider.provider)) continue;
    const list = map.get(provider.category);
    if (list) list.push(provider);
    else {
      order.push(provider.category);
      map.set(provider.category, [provider]);
    }
  }
  return order.map((category) => ({ category, providers: map.get(category) ?? [] }));
}

/**
 * Choose the connection rows a provider renders.
 *
 * @remarks
 * Linear is intentionally multi-account and returns every row. Legacy single-card providers keep
 * their first row (or one empty slot for the connect affordance), preserving their existing UI.
 */
export function visibleProviderConnections<T>(
  provider: string,
  connections: readonly T[],
): readonly (T | undefined)[] {
  return provider === 'linear' ? connections : [connections[0]];
}

/** Return linked Linear identities not already bound to a visible org connection. */
export function availableLinearAccounts(
  identities: readonly IdentityOut[],
  connections: readonly IntegrationOut[],
): readonly IdentityOut[] {
  const bound = new Set(
    connections
      .map((connection) => connection.externalAccountId)
      .filter((id): id is string => Boolean(id)),
  );
  return identities.filter(
    (identity) => identity.provider === 'linear' && !bound.has(identity.accountId),
  );
}
