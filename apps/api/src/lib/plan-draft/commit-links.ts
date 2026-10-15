import { initiativeProject, projectDependency, taskDependency } from '@docket/db';
import type { PlanDocument, PlanNode } from '@docket/work/plan-draft-contract';
import type { RecordedChange } from '../../mcp/change-set';
import type { TemplateTransaction } from '../templates/persistence';
import type { Placed } from '../organize/place';
import type { PreparedPlacementForest } from '../organize/forest-types';
import { requireForestReference } from '../organize/forest-matching';
import type { ForestDependency } from '../organize/forest-dependencies';

/** Authorized relationships staged before a plan writes any work or association. */
export interface PreparedPlanLink {
  readonly kind: 'project_contributes_to' | 'project_blocks' | 'blocks';
  readonly from: string;
  readonly to: string;
}
/** Confirmed and prospective plan identities consumed by read-first relation preparation. */
export interface PlanLinkContext {
  readonly tx: TemplateTransaction;
  readonly orgId: string;
  readonly document: PlanDocument;
  readonly byRef: ReadonlyMap<string, PlanNode>;
  readonly placedByRef: ReadonlyMap<string, Placed>;
}

function realId(context: PlanLinkContext, ref: string): string | null {
  return context.placedByRef.get(ref)?.id ?? context.byRef.get(ref)?.objectId ?? null;
}

/** Resolve and authorize every accepted-plan association before any physical insertion. */
export async function preparePlanLinks(
  context: PlanLinkContext,
  forest: PreparedPlacementForest,
): Promise<PreparedPlanLink[]> {
  const links = [...initiativeLinks(context), ...dependencyLinks(context)];
  const unique = [...new Map(links.map((link) => [JSON.stringify(link), link])).values()];
  for (const link of unique) {
    const fromKind = link.kind === 'blocks' ? 'task' : 'project';
    const toKind = link.kind === 'project_contributes_to' ? 'initiative' : fromKind;
    for (const [kind, id] of [
      [fromKind, link.from],
      [toKind, link.to],
    ] as const) {
      await requireForestReference(
        context.tx,
        forest,
        { organizationId: context.orgId, kind, id },
        'contribute',
      );
    }
  }
  return unique;
}

function initiativeLinks(context: PlanLinkContext): PreparedPlanLink[] {
  return context.document.nodes.flatMap((node) => {
    if (node.kind !== 'project' || !context.placedByRef.has(node.ref)) return [];
    const projectId = context.placedByRef.get(node.ref)?.id;
    if (!projectId) return [];
    const ids = [
      ...node.initiativeIds,
      ...node.initiativeRefs.flatMap((ref) => {
        const id = realId(context, ref);
        return id ? [id] : [];
      }),
    ];
    return ids.map((to) => ({ kind: 'project_contributes_to' as const, from: projectId, to }));
  });
}
function dependencyLinks(context: PlanLinkContext): PreparedPlanLink[] {
  const links: PreparedPlanLink[] = [];
  for (const edge of context.document.edges) {
    if (!context.placedByRef.has(edge.fromRef) && !context.placedByRef.has(edge.toRef)) continue;
    const from = realId(context, edge.fromRef),
      to = realId(context, edge.toRef);
    if (!from || !to || from === to) continue;
    const kind = context.byRef.get(edge.fromRef)?.kind;
    if (kind === 'task' || kind === 'project')
      links.push({ kind: kind === 'task' ? 'blocks' : 'project_blocks', from, to });
  }
  return links;
}

/** Project staged relationships onto the forest's combined prewrite dependency graph. */
export function planLinkDependencies(links: readonly PreparedPlanLink[]): ForestDependency[] {
  return links.flatMap((link) =>
    link.kind === 'project_contributes_to'
      ? []
      : [
          {
            kind: link.kind === 'blocks' ? ('task' as const) : ('project' as const),
            from: link.from,
            to: link.to,
          },
        ],
  );
}

/** Apply already-authorized links after all work exists, recording only relationships newly added. */
export async function applyPlanLinks(
  tx: TemplateTransaction,
  orgId: string,
  links: readonly PreparedPlanLink[],
): Promise<RecordedChange[]> {
  const changes: RecordedChange[] = [];
  for (const link of links) {
    if (await insertLink(tx, orgId, link)) changes.push({ ...link, linked: true });
  }
  return changes;
}
async function insertLink(
  tx: TemplateTransaction,
  orgId: string,
  link: PreparedPlanLink,
): Promise<boolean> {
  switch (link.kind) {
    case 'project_contributes_to':
      return (
        (
          await tx
            .insert(initiativeProject)
            .values({ organizationId: orgId, initiativeId: link.to, projectId: link.from })
            .onConflictDoNothing()
            .returning({ id: initiativeProject.projectId })
        ).length > 0
      );
    case 'project_blocks':
      return (
        (
          await tx
            .insert(projectDependency)
            .values({
              organizationId: orgId,
              blockingProjectId: link.from,
              blockedProjectId: link.to,
            })
            .onConflictDoNothing()
            .returning({ id: projectDependency.blockedProjectId })
        ).length > 0
      );
    case 'blocks':
      return (
        (
          await tx
            .insert(taskDependency)
            .values({ organizationId: orgId, blockingTaskId: link.from, blockedTaskId: link.to })
            .onConflictDoNothing()
            .returning({ id: taskDependency.blockedTaskId })
        ).length > 0
      );
  }
}
