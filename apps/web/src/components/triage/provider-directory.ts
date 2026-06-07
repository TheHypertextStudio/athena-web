/**
 * Resolve a linked task's source integration to a friendly provider name for the Triage
 * {@link import('./source-tag').SourceTag | source tag}.
 *
 * @remarks
 * A linked {@link TaskProvenance} carries a `sourceIntegrationId` (the org's integration
 * row id), not a human label — and the friendly name ("GitHub", "Linear", …) lives in the
 * connect-wizard *directory*, keyed by the provider *slug* (`github`, `linear`). So naming a
 * linked task's origin is a two-hop lookup: integration id → provider slug → directory name.
 *
 * {@link buildProviderResolver} composes the org's {@link IntegrationOut} list with the
 * {@link IntegrationDirectoryProvider} directory into a single `(integrationId) => name`
 * function the row can call. It degrades gracefully at every hop: an unknown integration id
 * (e.g. an integration since disconnected) falls back to a title-cased slug if one is somehow
 * known, otherwise to a neutral `"External"` label, so a linked task always reads as linked.
 */
import type { IntegrationDirectoryProvider, IntegrationOut } from '@docket/types';

/** The neutral label used when a linked task's provider cannot be resolved. */
const UNKNOWN_PROVIDER_LABEL = 'External';

/** Title-case a provider slug as a last-resort label (e.g. `github` → `Github`). */
function titleCase(slug: string): string {
  if (slug.length === 0) return UNKNOWN_PROVIDER_LABEL;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Build a resolver from an integration id to its friendly provider name.
 *
 * @remarks
 * Indexes the directory by provider slug once, then maps each integration id to its slug.
 * The returned function is pure and stable for the given inputs, so callers can safely
 * `useMemo` it. A `null`/`undefined` id (a linked task with no recorded integration) resolves
 * to {@link UNKNOWN_PROVIDER_LABEL}.
 *
 * @param integrations - The org's connected integrations (id → provider slug).
 * @param directory - The connect-wizard provider directory (slug → friendly name).
 * @returns a `(integrationId) => friendlyName` resolver.
 *
 * @example
 * ```ts
 * const providerName = buildProviderResolver(integrations, directory);
 * providerName(task.provenance.sourceIntegrationId); // "GitHub"
 * ```
 */
export function buildProviderResolver(
  integrations: readonly IntegrationOut[],
  directory: readonly IntegrationDirectoryProvider[],
): (integrationId: string | null | undefined) => string {
  const nameBySlug = new Map<string, string>(
    directory.map((entry) => [entry.provider, entry.name]),
  );
  const slugById = new Map<string, string>(
    integrations.map((integration) => [integration.id, integration.provider]),
  );

  return (integrationId: string | null | undefined): string => {
    if (!integrationId) return UNKNOWN_PROVIDER_LABEL;
    const slug = slugById.get(integrationId);
    if (!slug) return UNKNOWN_PROVIDER_LABEL;
    return nameBySlug.get(slug) ?? titleCase(slug);
  };
}
