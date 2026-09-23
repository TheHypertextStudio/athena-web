/**
 * `domain packages` — provenance: how a change entered Docket and who performed it.
 *
 * @remarks
 * Provenance has three parts, and conflating any two of them is what made the old record
 * unanswerable:
 *
 * - **Authority** — the human whose permissions the change ran under. It is the change set's
 *   `actorId` and the entity's `createdBy`, and it never changes meaning.
 * - **Performer** — who did the typing: the person, Athena, a third-party agent, or Docket itself.
 * - **Channel** — the door the change came through: the app, Athena, MCP, the REST API, email,
 *   an ongoing sync, a one-time import, or a rule Docket runs.
 *
 * {@link ChangeOrigin} is the stored shape. It is a superset of the first version, whose keys
 * (`tool`, `client`, `sessionId`, `planId`, `planOwnerUserId`) keep their top-level spelling
 * because existing readers query them directly. {@link readOrigin} turns any stored origin, old or
 * new, into the normalized {@link Provenance} every reader uses.
 */
import { z } from 'zod';

import { ActorId } from '@docket/identity-access/ids';

/** The door a change came through. */
export const PROVENANCE_CHANNELS = [
  'app',
  'athena',
  'mcp',
  'api',
  'email',
  'sync',
  'import',
  'rule',
] as const;

/** One provenance channel. */
export type ProvenanceChannel = (typeof PROVENANCE_CHANNELS)[number];

/** Zod schema for {@link ProvenanceChannel}. */
export const ProvenanceChannelSchema = z.enum(PROVENANCE_CHANNELS).meta({
  id: 'ProvenanceChannel',
  description:
    'How the change entered Docket: `app` (the Docket app), `athena` (Docket’s assistant), `mcp` (an MCP client), `api` (the REST API), `email` (mail accepted as work), `sync` (a connected tool’s ongoing sync), `import` (a one-time import), or `rule` (a schedule or rule Docket runs).',
});

/**
 * Where inside a channel the change happened.
 *
 * @remarks
 * Closed per channel: `app` surfaces are the parts of the app a person works in, `athena`
 * surfaces are the places Athena runs, and `rule` surfaces name the rule. MCP, API, email, sync,
 * and import changes carry no surface.
 */
export const PROVENANCE_SURFACES = {
  app: ['home', 'inbox', 'detail', 'list', 'canvas', 'plan', 'calendar', 'capture', 'settings'],
  athena: ['chat', 'session', 'phone'],
  rule: ['recurrence', 'routing', 'cycle_roll', 'calendar_link', 'time_anchor'],
} as const;

/** Every surface value across all channels. */
export const PROVENANCE_SURFACE_VALUES = [
  ...PROVENANCE_SURFACES.app,
  ...PROVENANCE_SURFACES.athena,
  ...PROVENANCE_SURFACES.rule,
] as const;

/** One provenance surface. */
export type ProvenanceSurface = (typeof PROVENANCE_SURFACE_VALUES)[number];

/** An app surface. */
export type AppSurface = (typeof PROVENANCE_SURFACES.app)[number];

/** The request header the app sets to name the surface a write came from. */
export const SURFACE_HEADER = 'Docket-Surface';

const APP_SURFACES: ReadonlySet<string> = new Set(PROVENANCE_SURFACES.app);

/**
 * Whether a value names a known app surface.
 *
 * @param value - A header value or other untrusted string.
 * @returns true when it is an {@link AppSurface}.
 */
export function isAppSurface(value: string | null | undefined): value is AppSurface {
  return typeof value === 'string' && APP_SURFACES.has(value);
}

/** Zod schema for {@link ProvenanceSurface}. */
export const ProvenanceSurfaceSchema = z.enum(PROVENANCE_SURFACE_VALUES).meta({
  id: 'ProvenanceSurface',
  description: 'Where inside the channel the change happened, when the channel has places.',
});

/** Who did the typing. */
export const PROVENANCE_PERFORMER_KINDS = ['person', 'athena', 'agent', 'docket'] as const;

/** One performer kind. */
export type ProvenancePerformerKind = (typeof PROVENANCE_PERFORMER_KINDS)[number];

/** The performer of a change, as stored. */
export interface ProvenancePerformer {
  readonly kind: ProvenancePerformerKind;
  /** The performing actor, when the performer is one (a person, or a registered agent). */
  readonly actorId?: string;
  /** Display name for a performer that is not a Docket actor (an MCP client, a provider). */
  readonly name?: string;
}

/** The connected tool behind a `sync` or `import` change. */
export interface ProvenanceIntegration {
  readonly id: string;
  /** Provider key, e.g. `linear`, `github`, `notion`. */
  readonly provider: string;
}

/** Links from a change back to the thing that caused it, when there is one. */
export interface ProvenanceRef {
  /** The repeating series a `rule/recurrence` change materialized. */
  readonly seriesId?: string;
  /** The routing or automation rule that fired. */
  readonly ruleId?: string;
  /** The inbound email accepted as work. */
  readonly messageId?: string;
  /** The canvas command id. */
  readonly commandId?: string;
}

/**
 * Where a change came from, recorded once per change set.
 *
 * @remarks
 * Every field but `tool` is optional in the stored type because rows written before provenance
 * v2 carry only `tool` and some of `client`, `sessionId`, `planId`, and `planOwnerUserId`. New
 * rows always carry `v: 2`, `channel`, and `performer`; read through {@link readOrigin}.
 */
export interface ChangeOrigin {
  readonly v?: 2;
  readonly channel?: ProvenanceChannel;
  readonly surface?: ProvenanceSurface;
  readonly performer?: ProvenancePerformer;
  /** Display name of the MCP or API client, when there is one. */
  readonly client?: string;
  /** The OAuth client id behind {@link ChangeOrigin.client}. */
  readonly clientId?: string;
  /** The version the MCP client reported on `initialize`, when it held a session. */
  readonly clientVersion?: string;
  readonly integration?: ProvenanceIntegration;
  /** The MCP session or Athena session the change arrived on. */
  readonly sessionId?: string;
  /** The plan draft this change confirmed, when it came from the planning canvas. */
  readonly planId?: string;
  /** The user who owns {@link ChangeOrigin.planId}. */
  readonly planOwnerUserId?: string;
  readonly ref?: ProvenanceRef;
  /** The operation that produced the change. Machine-only; never displayed. */
  readonly tool: string;
}

/** An origin as every new change records it: versioned, with its channel and performer. */
export interface RecordedOrigin extends ChangeOrigin {
  readonly v: 2;
  readonly channel: ProvenanceChannel;
  readonly performer: ProvenancePerformer;
}

/** The MCP or API client behind a change. */
export interface ProvenanceClient {
  readonly id: string | null;
  readonly name: string;
  readonly version: string | null;
}

/** The normalized provenance every reader works from. */
export interface Provenance {
  readonly channel: ProvenanceChannel;
  readonly surface: ProvenanceSurface | null;
  readonly performer: ProvenancePerformer;
  readonly client: ProvenanceClient | null;
  readonly integration: ProvenanceIntegration | null;
  readonly sessionId: string | null;
  readonly planId: string | null;
  readonly ref: ProvenanceRef | null;
}

/** Read a v2 origin, which already names its channel and performer. */
function readV2(origin: ChangeOrigin & { channel: ProvenanceChannel }): Provenance {
  return {
    channel: origin.channel,
    surface: origin.surface ?? null,
    performer: origin.performer ?? { kind: 'person' },
    client: origin.client
      ? { id: origin.clientId ?? null, name: origin.client, version: origin.clientVersion ?? null }
      : null,
    integration: origin.integration ?? null,
    sessionId: origin.sessionId ?? null,
    planId: origin.planId ?? null,
    ref: origin.ref ?? null,
  };
}

/** The channel, surface, and performer a first-version origin implies, or null when unknown. */
function legacyShape(
  origin: ChangeOrigin,
): Pick<ChangeOrigin, 'channel' | 'surface' | 'performer'> | null {
  if (origin.client === 'athena-phone') {
    return { channel: 'athena', surface: 'phone', performer: { kind: 'athena' } };
  }
  if (origin.tool === 'canvas') {
    return { channel: 'app', surface: 'canvas', performer: { kind: 'person' } };
  }
  // A client name or session id marks an MCP or Athena call, including the MCP `plan_commit`
  // tool; only a plan commit with neither came from the planning canvas in the app.
  if (origin.client) {
    return { channel: 'mcp', performer: { kind: 'agent', name: origin.client } };
  }
  if (origin.sessionId) {
    return { channel: 'athena', surface: 'session', performer: { kind: 'athena' } };
  }
  if (origin.tool === 'plan_commit' || origin.planId) {
    return { channel: 'app', surface: 'plan', performer: { kind: 'person' } };
  }
  return null;
}

/**
 * Normalize any stored origin into {@link Provenance}.
 *
 * @remarks
 * First-version rows are mapped by what they recorded: the phone client, the canvas and plan
 * tools, an MCP client name, or an Athena session id. A first-version row with none of those
 * cannot be placed and returns null, which readers render as nothing.
 *
 * @param origin - The stored origin.
 * @returns the normalized provenance, or null when the origin cannot be placed.
 */
export function readOrigin(origin: ChangeOrigin | null | undefined): Provenance | null {
  if (!origin) return null;
  if (origin.channel) return readV2({ ...origin, channel: origin.channel });
  const shape = legacyShape(origin);
  if (!shape?.channel) return null;
  return readV2({ ...origin, ...shape, channel: shape.channel });
}

/** One side of the provenance answer: a change, who authorized it, and how it arrived. */
export const ProvenanceEventOut = z
  .object({
    at: z.iso.datetime().describe('When the change was recorded.'),
    channel: ProvenanceChannelSchema,
    surface: ProvenanceSurfaceSchema.nullable(),
    performerKind: z
      .enum(PROVENANCE_PERFORMER_KINDS)
      .describe(
        'Who performed the change: `person`, `athena` (Docket’s assistant), `agent` (a third-party AI client), or `docket` (a rule, sync, or import).',
      ),
    performerName: z
      .string()
      .nullable()
      .describe(
        'Display name of the performer. Null when the performer is the authorizing person.',
      ),
    authorityActorId: ActorId.nullable().describe(
      'The member whose permissions the change ran under.',
    ),
    authorityName: z.string().nullable().describe('Display name of that member.'),
    clientName: z.string().nullable().describe('The MCP or API client, when there is one.'),
    provider: z
      .string()
      .nullable()
      .describe('The connected tool behind a `sync` or `import` change.'),
    sessionId: z.string().nullable().describe('The Athena or MCP session the change arrived on.'),
    planId: z.string().nullable().describe('The plan the change confirmed.'),
  })
  .meta({ id: 'ProvenanceEvent', description: 'One recorded change and where it came from.' });

/** One side of the provenance answer. */
export type ProvenanceEventOut = z.infer<typeof ProvenanceEventOut>;

/** Where an entity came from and who last changed it. */
export const ProvenanceOut = z
  .object({
    created: ProvenanceEventOut.nullable().describe(
      'The change that created the entity. Null when it predates provenance recording.',
    ),
    lastChanged: ProvenanceEventOut.nullable().describe(
      'The most recent recorded change. Null when nothing has changed since creation.',
    ),
    changeCount: z.number().int().nonnegative().describe('How many recorded changes touched it.'),
  })
  .meta({ id: 'Provenance', description: 'Where an entity came from and who last changed it.' });

/** Where an entity came from and who last changed it. */
export type ProvenanceOut = z.infer<typeof ProvenanceOut>;

/** Compact provenance carried on an activity row. */
export const ActivityOriginOut = z
  .object({
    channel: ProvenanceChannelSchema,
    surface: ProvenanceSurfaceSchema.nullable(),
    performerKind: z
      .enum(PROVENANCE_PERFORMER_KINDS)
      .describe(
        'Who performed the change: `person`, `athena` (Docket’s assistant), `agent` (a third-party AI client), or `docket` (a rule, sync, or import).',
      ),
    performerName: z
      .string()
      .nullable()
      .describe('Display name of the performer. Null when the performer is the member who acted.'),
    clientName: z.string().nullable().describe('The MCP or API client, when there is one.'),
    provider: z
      .string()
      .nullable()
      .describe('The connected tool behind a `sync` or `import` change.'),
  })
  .meta({ id: 'ActivityOrigin', description: 'Where an activity entry’s change came from.' });

/** Compact provenance carried on an activity row. */
export type ActivityOriginOut = z.infer<typeof ActivityOriginOut>;

/** The kinds of entity the provenance endpoint answers for. */
export const PROVENANCE_ENTITY_KINDS = ['task', 'project', 'initiative', 'program'] as const;

/** One entity kind the provenance endpoint answers for. */
export type ProvenanceEntityKind = (typeof PROVENANCE_ENTITY_KINDS)[number];

/**
 * Project a normalized provenance onto the activity-row shape.
 *
 * @param provenance - The normalized provenance.
 * @returns the compact activity origin.
 */
export function toActivityOrigin(provenance: Provenance): ActivityOriginOut {
  return {
    channel: provenance.channel,
    surface: provenance.surface,
    performerKind: provenance.performer.kind,
    performerName: provenance.performer.name ?? null,
    clientName: provenance.client?.name ?? null,
    provider: provenance.integration?.provider ?? null,
  };
}
