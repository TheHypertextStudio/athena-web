import type { api as ApiClient } from './api';
import { fetchAllCursorPages } from './fetch-all-cursor-pages';

function cursorQuery(cursor: string | undefined): { limit: string; cursor?: string } {
  return { limit: '100', ...(cursor ? { cursor } : {}) };
}

/** Fetch every display override for one public entity kind. */
export function fetchAllEntityDisplays(
  client: typeof ApiClient,
  organizationId: string,
  subjectType:
    | 'team'
    | 'task'
    | 'project'
    | 'program'
    | 'initiative'
    | 'milestone'
    | 'cycle'
    | 'label'
    | 'workStatus',
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].display[':subjectType'].$get({
      param: { orgId: organizationId, subjectType },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every workspace the caller can currently enter. */
export function fetchAllOrganizations(client: typeof ApiClient) {
  return fetchAllCursorPages((cursor) => client.v1.orgs.$get({ query: cursorQuery(cursor) }));
}

/** Fetch every active Team in one organization. */
export function fetchAllTeams(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].teams.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every Team-member identity pair for workspace-wide roster projections. */
export function fetchAllTeamRosters(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].teams.rosters.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every member of one Team. */
export function fetchAllTeamMembers(
  client: typeof ApiClient,
  organizationId: string,
  teamId: string,
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].teams[':teamId'].members.$get({
      param: { orgId: organizationId, teamId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every human member in one organization. */
export function fetchAllMembers(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].members.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every pending invitation in one organization. */
export function fetchAllInvitations(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].members.invitations.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch the complete visible label catalog, with optional usage counts. */
export function fetchAllLabels(
  client: typeof ApiClient,
  organizationId: string,
  options: { readonly withCounts?: '0' | '1' } = {},
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].labels.$get({
      param: { orgId: organizationId },
      query: { ...options, ...cursorQuery(cursor) },
    }),
  );
}

/** Fetch every label group in its presentation order. */
export function fetchAllLabelGroups(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].labels.groups.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every Role in one organization. */
export function fetchAllRoles(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].roles.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every registered Agent in one organization. */
export function fetchAllAgents(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].agents.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every Integration connected to one organization. */
export function fetchAllIntegrations(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].integrations.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch a complete subject discussion in its canonical chronological order. */
export function fetchAllComments(
  client: typeof ApiClient,
  organizationId: string,
  subject: {
    readonly subjectType: 'task' | 'project' | 'program' | 'initiative' | 'cycle';
    readonly subjectId: string;
  },
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].comments.$get({
      param: { orgId: organizationId },
      query: { ...subject, ...cursorQuery(cursor) },
    }),
  );
}

/** Fetch every milestone in one Project. */
export function fetchAllMilestones(
  client: typeof ApiClient,
  organizationId: string,
  projectId: string,
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].projects[':id'].milestones.$get({
      param: { orgId: organizationId, id: projectId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every template visible to the caller, optionally narrowed by target kind. */
export function fetchAllTemplates(
  client: typeof ApiClient,
  organizationId: string,
  options: { readonly targetType?: 'task' | 'project' | 'program' | 'initiative' } = {},
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].templates.$get({
      param: { orgId: organizationId },
      query: { ...options, ...cursorQuery(cursor) },
    }),
  );
}

/** Fetch every status Update for one supported subject. */
export function fetchAllUpdates(
  client: typeof ApiClient,
  organizationId: string,
  subject: {
    readonly subjectType: 'project' | 'program' | 'initiative';
    readonly subjectId: string;
  },
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].updates.$get({
      param: { orgId: organizationId },
      query: { ...subject, ...cursorQuery(cursor) },
    }),
  );
}

/** Fetch every attachment visible on one Task. */
export function fetchAllTaskAttachments(
  client: typeof ApiClient,
  organizationId: string,
  taskId: string,
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].tasks[':id'].attachments.$get({
      param: { orgId: organizationId, id: taskId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every URL resource attached to one Project. */
export function fetchAllProjectResources(
  client: typeof ApiClient,
  organizationId: string,
  projectId: string,
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].projects[':id'].resources.$get({
      param: { orgId: organizationId, id: projectId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every URL resource attached to one Initiative. */
export function fetchAllInitiativeResources(
  client: typeof ApiClient,
  organizationId: string,
  initiativeId: string,
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].initiatives[':id'].resources.$get({
      param: { orgId: organizationId, id: initiativeId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every label attached to one Initiative. */
export function fetchAllInitiativeLabels(
  client: typeof ApiClient,
  organizationId: string,
  initiativeId: string,
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].initiatives[':id'].labels.$get({
      param: { orgId: organizationId, id: initiativeId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every JSON activity row for one organization agent session. */
export function fetchAllSessionActivity(
  client: typeof ApiClient,
  organizationId: string,
  sessionId: string,
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].sessions[':id'].activity.$get({
      param: { orgId: organizationId, id: sessionId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every pending proposal group for one organization agent session. */
export function fetchAllSessionProposals(
  client: typeof ApiClient,
  organizationId: string,
  sessionId: string,
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].sessions[':id'].proposals.$get({
      param: { orgId: organizationId, id: sessionId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every organization agent session visible to the caller. */
export function fetchAllSessions(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].sessions.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every saved view owned by the current actor in one organization. */
export function fetchAllSavedViews(client: typeof ApiClient, organizationId: string) {
  return client.v1.orgs[':orgId']['saved-views'].$get({
    param: { orgId: organizationId },
  });
}

/** Fetch every automation rule in one organization. */
export function fetchAllAutomationRules(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId']['automation-rules'].$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every process definition in one organization. */
export function fetchAllProcessDefinitions(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId']['process-definitions'].$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every email suggestion in one organization. */
export function fetchAllEmailSuggestions(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId']['email-suggestions'].$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every publication configuration in one organization. */
export function fetchAllPublications(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].publications.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every custom publishing domain in one organization. */
export function fetchAllPublishingDomains(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].publishing.domains.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every configured MCP integration in one organization. */
export function fetchAllMcpIntegrations(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].integrations.mcp.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every Notion person discovered for one integration. */
export function fetchAllNotionPeople(
  client: typeof ApiClient,
  organizationId: string,
  integrationId: string,
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].integrations[':id'].notion.people.$get({
      param: { orgId: organizationId, id: integrationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every personal Athena mail attachment target. */
export function fetchAllAthenaMailAttachmentTargets(client: typeof ApiClient, messageId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.me.athena.mail[':id'].attachments.$get({
      param: { id: messageId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every message in the caller's Athena inbox. */
export function fetchAllAthenaMail(client: typeof ApiClient) {
  return fetchAllCursorPages((cursor) =>
    client.v1.me.athena.mail.$get({ query: cursorQuery(cursor) }),
  );
}

/** Fetch every Athena message attached to one work item. */
export function fetchAllAttachedAthenaMail(
  client: typeof ApiClient,
  subject: {
    readonly subjectType: 'task' | 'project' | 'initiative';
    readonly subjectId: string;
    readonly organizationId: string;
  },
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.me.athena.mail.attached.$get({
      query: { ...subject, ...cursorQuery(cursor) },
    }),
  );
}

/** Fetch every active Task visible to the caller, preserving the server's canonical order. */
export function fetchAllTasks(
  client: typeof ApiClient,
  organizationId: string,
  filters: { readonly programId?: string; readonly labelId?: string } = {},
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].tasks.$get({
      param: { orgId: organizationId },
      query: { ...filters, ...cursorQuery(cursor) },
    }),
  );
}

/** Fetch every active Project in one organization for complete-corpus first-party selectors. */
export function fetchAllProjects(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].projects.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every Program in one organization for complete-corpus first-party selectors. */
export function fetchAllPrograms(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].programs.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every Initiative in one organization for complete-corpus first-party selectors. */
export function fetchAllInitiatives(client: typeof ApiClient, organizationId: string) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].initiatives.$get({
      param: { orgId: organizationId },
      query: cursorQuery(cursor),
    }),
  );
}

/** Fetch every Cycle in one organization, optionally materializing its rolling windows first. */
export function fetchAllCycles(
  client: typeof ApiClient,
  organizationId: string,
  options: { readonly roll?: 'true' | 'false' } = {},
) {
  return fetchAllCursorPages((cursor) =>
    client.v1.orgs[':orgId'].cycles.$get({
      param: { orgId: organizationId },
      query: { ...options, ...cursorQuery(cursor) },
    }),
  );
}
