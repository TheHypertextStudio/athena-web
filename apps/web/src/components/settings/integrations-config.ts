import type { IntegrationOut } from '@docket/types';
import { CONNECTOR_PROVIDER_IDS, connectorIdentityProvider } from '@docket/types';
import {
  Calendar,
  Github,
  Layers,
  ListChecks,
  type LucideIcon,
  Mail,
  Sparkles,
  TaskAlt,
} from '@docket/ui/icons';

/** PROVIDER_ICON maps integration providers to their display icon component. */
export const PROVIDER_ICON: Record<string, LucideIcon> = {
  github: Github,
  linear: Layers,
  gmail: Mail,
  calendar: Calendar,
  gtasks: TaskAlt,
  notion: ListChecks,
};

/**
 * Providers whose connect ceremony is a full-page redirect to `GET /:id/connect-url` (a signed
 * provider consent/install URL that calls back to `/internal/integrations/<provider>/callback`)
 * rather than a Better Auth social-link. The callback returns to settings with
 * `?<provider>=connected|error`.
 */
export const REDIRECT_CONNECT_PROVIDERS: ReadonlySet<string> = new Set(['github']);

/** providerIcon returns the icon component for an integration provider. */
export function providerIcon(provider: string): LucideIcon {
  return PROVIDER_ICON[provider] ?? Sparkles;
}

/** CATEGORY_LABEL maps integration enum values to user-facing labels. */
export const CATEGORY_LABEL: Record<string, string> = {
  engineering: 'Engineering',
  'project-management': 'Project management',
  documents: 'Documents',
  communication: 'Communication',
};

/** STATUS_LABEL maps integration enum values to user-facing labels + badge variants. */
export const STATUS_LABEL: Record<
  IntegrationOut['status'],
  { label: string; variant: 'secondary' | 'destructive' | 'outline' }
> = {
  // `pending` is created-but-not-yet-validated: never shown as connected.
  pending: { label: 'Not connected', variant: 'outline' },
  connected: { label: 'Connected', variant: 'secondary' },
  error: { label: 'Needs attention', variant: 'destructive' },
  disconnected: { label: 'Disconnected', variant: 'outline' },
};

/**
 * Map a connector provider to the Better Auth social provider whose OAuth grant funds it.
 *
 * @remarks
 * Mirrors the server's `socialProviderId`: all three Google products share the one `google`
 * grant; GitHub and Linear each have their own. Used to decide which
 * provider's OAuth redirect to launch when finishing/repairing a connection.
 */
export function socialProviderForConnector(
  provider: string,
): 'google' | 'github' | 'linear' | 'notion' {
  const connectorProvider = CONNECTOR_PROVIDER_IDS.find((p) => p === provider);
  const identityProvider = connectorProvider
    ? connectorIdentityProvider(connectorProvider)
    : 'google';
  return identityProvider;
}

// Provider/connector *availability* (isMockMode, connectorOAuthConfigured, connectorAvailable) is
// derived from the server's `/v1/config` — see `@/lib/public-config`. This module holds only the
// static display catalog (icons, labels) and the connector → social-provider mapping above, so no
// component reads availability from the environment.

/** categoryLabel returns display copy for an integration provider category. */
export function categoryLabel(category: string): string {
  return (
    CATEGORY_LABEL[category] ??
    category
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}

/**
 * Per-provider wording for the connector config panel (`IntegrationConfigPanel`).
 *
 * @remarks
 * Generalizes what used to be Google-Tasks-only copy hardcoded into the panel, so adding a new
 * connector's config UI is a data change here rather than a JSX branch there.
 */
export interface ConnectorCopy {
  /** Singular noun for one external container this connector exposes (Linear "team", Google Tasks "list"). */
  containerNoun: string;
  /** Plural form, used in list/legend copy ("teams", "task lists"). */
  containerNounPlural: string;
  /**
   * Singular noun for the "sync all"/"select at least one" checklist copy specifically.
   *
   * @remarks
   * Deliberately a SEPARATE field from {@link containerNoun}, not the same value reused: Google
   * Tasks' checklist has always read "Sync all lists" / "Select at least one list…" in the bare,
   * unqualified form, even though its other captions ("Task lists to sync", "No task lists
   * found…") use the fuller "task list(s)". Collapsing both onto one noun would either change
   * this checklist's wording (a regression) or the other captions' (an unrelated wording change)
   * — so the checklist gets its own noun per provider instead of the JSX special-casing gtasks.
   */
  checklistNoun: string;
  /** Plural form of {@link checklistNoun}. */
  checklistNounPlural: string;
  /** Sync-direction detail copy, tailored to what this connector actually mirrors. */
  direction: {
    importOnly: string;
    twoWay: string;
  };
  /** A one-line "what this keeps in sync" blurb, in user terms (no provider jargon). */
  connectBlurb: string;
  /**
   * Whether this connector's containers route many-to-one onto Docket teams via
   * `config.teamMappings` (Linear: each external team picks its own Docket team) rather than a
   * flat container checklist plus a single target team (Google Tasks: pick lists, land in one
   * team). See `ConnectorConfig.teamMappings` in `@docket/types`.
   */
  usesTeamMapping: boolean;
}

/** Fallback copy for a connector with no dedicated entry below (kept generic, never provider-named). */
const DEFAULT_CONNECTOR_COPY: ConnectorCopy = {
  containerNoun: 'list',
  containerNounPlural: 'lists',
  checklistNoun: 'list',
  checklistNounPlural: 'lists',
  direction: {
    importOnly: 'Pull items into Docket. Local edits stay in Docket.',
    twoWay: 'Edits, completions, and deletions sync in both directions (last edit wins).',
  },
  connectBlurb: 'Mirror this tool into Docket.',
  usesTeamMapping: false,
};

/** CONNECTOR_COPY maps each connector provider to its config-panel wording. */
export const CONNECTOR_COPY: Record<string, ConnectorCopy> = {
  gtasks: {
    containerNoun: 'task list',
    containerNounPlural: 'task lists',
    // Bare "list(s)", not "task list(s)" — the checklist's original wording, preserved verbatim.
    checklistNoun: 'list',
    checklistNounPlural: 'lists',
    direction: {
      importOnly: 'Pull Google Tasks into Docket. Local edits stay in Docket.',
      twoWay: 'Edits, completions, and deletions sync in both directions (last edit wins).',
    },
    connectBlurb: 'Mirror your Google Tasks lists into Docket.',
    usesTeamMapping: false,
  },
  linear: {
    containerNoun: 'team',
    containerNounPlural: 'teams',
    // Unused today (linear.usesTeamMapping routes it to the team-mapping picker instead of the
    // flat checklist), kept equal to containerNoun so it is never an accidental mismatch.
    checklistNoun: 'team',
    checklistNounPlural: 'teams',
    direction: {
      importOnly:
        'Pull Linear issues, projects, and cycles into Docket. Local edits stay in Docket.',
      twoWay: 'Edits, completions, and deletions sync in both directions (last edit wins).',
    },
    connectBlurb: 'Mirror Linear issues, projects, and cycles into Docket.',
    usesTeamMapping: true,
  },
  notion: {
    containerNoun: 'database',
    containerNounPlural: 'databases',
    checklistNoun: 'database',
    checklistNounPlural: 'databases',
    direction: {
      importOnly: 'Pull Notion database rows into Docket. Local edits stay in Docket.',
      // Notion is the one connector where Docket, not the source tool, settles a conflict.
      twoWay:
        'Edits, completions, and deletions sync in both directions. If the same field changes on both sides, Docket wins and the Notion value is kept in the sync history.',
    },
    connectBlurb: 'Keep Notion databases and Docket tasks in step, with Docket in charge.',
    usesTeamMapping: false,
  },
};

/** connectorCopy returns the config-panel wording for a provider, falling back to generic copy. */
export function connectorCopy(provider: string): ConnectorCopy {
  return CONNECTOR_COPY[provider] ?? DEFAULT_CONNECTOR_COPY;
}

/**
 * Card-level copy explaining what an unconnected workspace connection does.
 */
export interface ConnectionCardCopy {
  /** What connecting this unlocks, in user terms (no provider jargon). */
  effect: string;
}

/** Per-provider card copy for the Connections surface. Falls back to generic wording. */
const CONNECTION_CARD_COPY: Record<string, ConnectionCardCopy> = {
  gtasks: {
    effect: 'Athena keeps your Google Tasks and Docket tasks in step.',
  },
  calendar: {
    effect: 'Athena sees your events to plan around them.',
  },
  gmail: {
    effect: 'Athena reads new mail so it can suggest tasks in triage.',
  },
  linear: {
    effect: 'Athena mirrors Linear issues, projects, and cycles as tasks.',
  },
  github: {
    effect: 'Athena links pull requests and issues to your work.',
  },
  notion: {
    effect: 'Athena keeps your Notion databases and Docket tasks in step.',
  },
};

/** The generic fallback shown for a provider with no dedicated card copy above. */
const DEFAULT_CONNECTION_CARD_COPY: ConnectionCardCopy = {
  effect: 'Athena mirrors this tool into Docket.',
};

/** connectionCardCopy returns the Connections-card wording for a provider. */
export function connectionCardCopy(provider: string): ConnectionCardCopy {
  return CONNECTION_CARD_COPY[provider] ?? DEFAULT_CONNECTION_CARD_COPY;
}

/**
 * Which connector providers render their config panel inline on the Connections surface (a
 * "Configure" toggle on the generic {@link IntegrationProviderCard} row).
 *
 * @remarks
 * Google Tasks is excluded here even though it has a config panel — it renders its own dedicated
 * multi-account section (`GtasksAccountsSection`) instead of the generic provider-card list, so
 * wiring it through this flag would double-render its picker. Linear and Notion both configure on
 * the generic card: Notion's picker is the list of Notion databases to sync.
 */
export function hasInlineConfigPanel(provider: string): boolean {
  return provider === 'linear';
}

/**
 * The dedicated settings page a provider manages itself on, when it has one.
 *
 * @remarks
 * Notion outgrew the inline disclosure: nine designed databases, a table designer, identity
 * matching and sync history do not fit inside a card, and burying them three levels deep is what
 * made connector configuration hard to find in the first place. A provider with a page here shows
 * a link on its card instead of a Configure toggle — which is also the ONLY way to reach the page,
 * so it is not optional garnish.
 *
 * @param provider - The connector provider id.
 * @param orgId - The workspace whose settings the link points into.
 * @returns the route, or null for a provider configured inline.
 */
export function providerManageHref(provider: string, orgId: string): string | null {
  return provider === 'notion' ? `/orgs/${orgId}/settings/connections/notion` : null;
}
