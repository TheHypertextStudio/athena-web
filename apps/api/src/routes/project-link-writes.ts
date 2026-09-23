/**
 * `@docket/api` — replace a project's labels and initiative links from a REST PATCH.
 *
 * @remarks
 * Returns the edges it added and removed so the route can record them in the same change set as
 * the project update. It records nothing itself.
 */
import { initiativeProject, projectLabel } from '@docket/db';
import { and, eq } from 'drizzle-orm';

import { replaceLabels, type ResolvedLabel } from '../lib/labels';
import type { LinkRecord } from '../mcp/change-set';
import { edgeChanges, type RouteTx } from './container-change-sets';

/** The link replacements one project PATCH asked for. */
export interface ProjectLinkReplacement {
  readonly orgId: string;
  readonly projectId: string;
  /** The requested label ids; undefined leaves the labels alone. */
  readonly labelIds: readonly string[] | undefined;
  /** The resolved labels to store when `labelIds` is present. */
  readonly labels: readonly ResolvedLabel[];
  /** The validated initiative ids; undefined leaves the links alone. */
  readonly initiativeIds: readonly string[] | undefined;
}

/** Replace the project's labels and return the label edges that changed. */
async function replaceProjectLabels(
  tx: RouteTx,
  input: ProjectLinkReplacement,
): Promise<LinkRecord[]> {
  if (input.labelIds === undefined) return [];
  const rows = await tx
    .select({ labelId: projectLabel.labelId })
    .from(projectLabel)
    .where(
      and(
        eq(projectLabel.organizationId, input.orgId),
        eq(projectLabel.projectId, input.projectId),
      ),
    );
  await replaceLabels(tx, 'project', input.projectId, input.orgId, input.labels);
  return edgeChanges(
    'project_has_label',
    input.projectId,
    rows.map((row) => row.labelId),
    input.labels.map((label) => label.id),
  );
}

/** Replace the project's initiative links and return the edges that changed. */
async function replaceProjectInitiatives(
  tx: RouteTx,
  input: ProjectLinkReplacement,
): Promise<LinkRecord[]> {
  const { initiativeIds, orgId, projectId } = input;
  if (initiativeIds === undefined) return [];
  const scope = and(
    eq(initiativeProject.organizationId, orgId),
    eq(initiativeProject.projectId, projectId),
  );
  const rows = await tx
    .delete(initiativeProject)
    .where(scope)
    .returning({ initiativeId: initiativeProject.initiativeId });
  if (initiativeIds.length > 0) {
    await tx
      .insert(initiativeProject)
      .values(
        initiativeIds.map((initiativeId) => ({ organizationId: orgId, initiativeId, projectId })),
      );
  }
  return edgeChanges(
    'project_contributes_to',
    projectId,
    rows.map((row) => row.initiativeId),
    initiativeIds,
  );
}

/**
 * Apply a PATCH's label and initiative-link replacements to a project.
 *
 * @param tx - The PATCH's transaction.
 * @param input - The project and the replacements it asked for.
 * @returns the label and initiative edges that were added or removed.
 */
export async function replaceProjectLinks(
  tx: RouteTx,
  input: ProjectLinkReplacement,
): Promise<LinkRecord[]> {
  const labels = await replaceProjectLabels(tx, input);
  return [...labels, ...(await replaceProjectInitiatives(tx, input))];
}
