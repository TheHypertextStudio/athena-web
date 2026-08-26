import type {
  AppCapability,
  CapabilityContext,
  CapabilityTarget,
  ResolvedCapability,
} from './types';

export type {
  AppCapability,
  CapabilityContext,
  CapabilityIntent,
  CapabilityTarget,
  ResolvedCapability,
} from './types';

function resolveValue<T>(
  value: T | ((context: CapabilityContext) => T),
  context: CapabilityContext,
): T {
  return typeof value === 'function'
    ? (value as (context: CapabilityContext) => T)(context)
    : value;
}

function resolveTarget(entry: AppCapability, context: CapabilityContext): CapabilityTarget {
  if (entry.target.type === 'intent') return entry.target;
  return { type: 'route', href: resolveValue(entry.target.href, context) };
}

/** Resolve the catalog against one viewer and remove capabilities that viewer cannot reach. */
export function resolveCapabilities(
  entries: readonly AppCapability[],
  context: CapabilityContext,
): readonly ResolvedCapability[] {
  return entries.flatMap((entry) => {
    if (entry.available && !entry.available(context)) return [];
    const label = resolveValue(entry.label, context);
    const breadcrumb = entry.breadcrumb ? resolveValue(entry.breadcrumb, context) : [];
    const target = resolveTarget(entry, context);
    if (target.type === 'route' && !target.href) return [];
    return [
      {
        id: entry.id,
        label,
        description: entry.description,
        aliases: entry.aliases ?? [],
        icon: entry.icon,
        breadcrumb,
        requiresQuery: entry.requiresQuery ?? false,
        target,
        ...(entry.scope === 'workspace' && context.activeOrgId && context.activeOrgName
          ? { org: { id: context.activeOrgId, name: context.activeOrgName } }
          : {}),
      },
    ];
  });
}

/** Reject catalog mistakes that would make a shipped capability ambiguous or unsearchable. */
export function validateCapabilityCatalog(entries: readonly AppCapability[]): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.id.trim()) throw new Error('Capability ids must not be empty.');
    if (ids.has(entry.id)) throw new Error(`Duplicate capability id: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.description.trim()) {
      throw new Error(`Capability ${entry.id} must have a description.`);
    }
    if (entry.target.type === 'route' && typeof entry.target.href === 'string') {
      if (!entry.target.href.startsWith('/')) {
        throw new Error(`Capability ${entry.id} must use an application route.`);
      }
    }
  }
}
