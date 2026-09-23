/**
 * Display labels for provenance: who performed a change and through which channel.
 *
 * @remarks
 * Every surface that names where a change came from (the origin card, the activity feed) reads its
 * words from here, so the vocabulary in `docs/engineering/specs/provenance.md` §4 lives in one
 * place. The result is labels, never sentences: a performer ("Athena", "Claude Code", "Linear"),
 * an optional channel detail ("Chat", "for You", "Synced"), and the avatar kind to draw.
 */
import type { ActorKind } from '@docket/ui/components';
import {
  PROVIDER_CATALOG,
  type ProviderCatalogEntry,
} from '@docket/connections/provider-catalog-contract';
import type {
  ActivityOriginOut,
  ProvenanceEventOut,
  ProvenanceSurface,
} from '@docket/work/provenance-contract';

/** The fields of a recorded origin the formatter reads; both wire shapes carry them. */
export type ProvenanceOrigin = Pick<
  ActivityOriginOut,
  'channel' | 'surface' | 'performerKind' | 'performerName' | 'clientName' | 'provider'
>;

/** The member whose permissions a change ran under. */
export interface ProvenanceAuthority {
  readonly actorId: string | null;
  readonly name: string | null;
}

/** One change's origin, ready to render. */
export interface ProvenanceDisplay {
  /** Who performed the change: "You", a teammate, "Athena", a client, or a provider. */
  readonly performer: string;
  /** How it arrived ("Chat", "for You", "API", "Synced"), or null when the performer says it all. */
  readonly detail: string | null;
  /** The avatar shape: a person, or an agent for Athena, clients, and Docket itself. */
  readonly avatarKind: ActorKind;
  /** The name the avatar draws its initials from, when it is not the performer label ("You"). */
  readonly avatarName?: string;
}

/** The name Docket's assistant goes by. */
const ATHENA = 'Athena';

/** The name Docket goes by when a rule it runs made the change. */
const DOCKET = 'Docket';

/** The label for each surface a change can arrive through. */
const SURFACE_LABEL: Readonly<Partial<Record<ProvenanceSurface, string>>> = {
  chat: 'Chat',
  session: 'Session',
  phone: 'Phone call',
  recurrence: 'Repeats',
  routing: 'Rule',
  cycle_roll: 'Cycle rollover',
  calendar_link: 'Calendar link',
  time_anchor: 'Time tracking',
};

/**
 * The display name of a connected tool.
 *
 * @param provider - The provider key, e.g. `linear`.
 * @returns the catalog name, or the key with its first letter capitalized.
 */
export function providerLabel(provider: string): string {
  const entry = (PROVIDER_CATALOG as Readonly<Partial<Record<string, ProviderCatalogEntry>>>)[
    provider
  ];
  if (entry) return entry.name;
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** The label of a surface, or null when it has none. */
function surfaceLabel(surface: ProvenanceSurface | null): string | null {
  return surface === null ? null : (SURFACE_LABEL[surface] ?? null);
}

/** Name the authorizing member relative to the viewer. */
function authorityLabel(
  authority: ProvenanceAuthority | null,
  currentActorId: string | null,
): string | null {
  if (authority === null) return null;
  if (authority.actorId !== null && authority.actorId === currentActorId) return 'You';
  return authority.name;
}

/** A person working in the app, named as "You" or by their name. */
function formatApp(
  authority: ProvenanceAuthority | null,
  currentActorId: string | null,
): ProvenanceDisplay | null {
  const performer = authorityLabel(authority, currentActorId);
  if (performer === null) return null;
  const avatarName = authority?.name ?? null;
  return {
    performer,
    detail: null,
    avatarKind: 'human',
    ...(avatarName === null || avatarName === performer ? {} : { avatarName }),
  };
}

/** An MCP client acting for its owner, or a registered agent acting as itself. */
function formatMcp(
  origin: ProvenanceOrigin,
  authority: ProvenanceAuthority | null,
  currentActorId: string | null,
): ProvenanceDisplay | null {
  const client = origin.performerName ?? origin.clientName;
  if (client === null) {
    const agent = authority?.name ?? null;
    return agent === null ? null : { performer: agent, detail: null, avatarKind: 'agent' };
  }
  const owner = authorityLabel(authority, currentActorId);
  return { performer: client, detail: owner === null ? null : `for ${owner}`, avatarKind: 'agent' };
}

/** A REST client with an OAuth token. */
function formatApi(
  origin: ProvenanceOrigin,
  authority: ProvenanceAuthority | null,
): ProvenanceDisplay | null {
  const client = origin.clientName ?? origin.performerName ?? authority?.name ?? null;
  return client === null ? null : { performer: client, detail: 'API', avatarKind: 'agent' };
}

/** A connected tool's sync or one-time import. */
function formatIntegration(origin: ProvenanceOrigin, detail: string): ProvenanceDisplay | null {
  const name = origin.provider === null ? origin.performerName : providerLabel(origin.provider);
  return name === null ? null : { performer: name, detail, avatarKind: 'agent' };
}

/**
 * Turn a recorded origin into display labels.
 *
 * @param origin - The origin, from a provenance event or an activity row.
 * @param authority - The member the change ran under, when known.
 * @param currentActorId - The viewer's actor in this workspace, so their own changes read "You".
 * @returns the labels, or null when the origin cannot be named.
 */
export function formatProvenance(
  origin: ProvenanceOrigin,
  authority: ProvenanceAuthority | null,
  currentActorId: string | null,
): ProvenanceDisplay | null {
  switch (origin.channel) {
    case 'app':
      return formatApp(authority, currentActorId);
    case 'athena':
      return { performer: ATHENA, detail: surfaceLabel(origin.surface), avatarKind: 'agent' };
    case 'email':
      return { performer: ATHENA, detail: 'From email', avatarKind: 'agent' };
    case 'mcp':
      return formatMcp(origin, authority, currentActorId);
    case 'api':
      return formatApi(origin, authority);
    case 'sync':
      return formatIntegration(origin, 'Synced');
    case 'import':
      return formatIntegration(origin, 'Imported');
    case 'rule':
      return { performer: DOCKET, detail: surfaceLabel(origin.surface), avatarKind: 'agent' };
  }
}

/**
 * Display labels for one side of the provenance answer.
 *
 * @param event - The created or last-changed event.
 * @param currentActorId - The viewer's actor in this workspace.
 * @returns the labels, or null when the event cannot be named.
 */
export function formatProvenanceEvent(
  event: ProvenanceEventOut,
  currentActorId: string | null,
): ProvenanceDisplay | null {
  return formatProvenance(
    event,
    { actorId: event.authorityActorId, name: event.authorityName },
    currentActorId,
  );
}
