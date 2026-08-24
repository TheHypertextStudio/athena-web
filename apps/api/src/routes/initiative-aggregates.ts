/** Aggregate Initiative overview reads. */
import {
  actor,
  attachment,
  db,
  entityDisplay,
  initiative,
  initiativeHierarchyLink,
  initiativeLabel,
  initiativeProgram,
  initiativeProject,
  label,
  organization,
  program,
  project,
  update,
} from '@docket/db';
import {
  defaultEntityDisplay,
  InitiativeAggregateDetail,
  InitiativeDetailAggregate,
  InitiativeId,
  InitiativeOverviewOut,
  InitiativeRelationshipSections,
} from '@docket/types';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv, AuthSession } from '../context';
import { NotFoundError } from '../error';
import { detailCapabilities } from '../lib/detail-capabilities';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam } from '../lib/validate';
import { rankInitiativeAttention } from './initiative-attention';
import { accessibleInitiativeOrganizationIds } from './initiative-hierarchy';
import {
  buildInitiativeDetail,
  buildInitiativeDetailFromSummary,
  loadInitiative,
  associatedWorkSummary,
  toOut,
} from './initiative-helpers';

/** Convert a hierarchy node to the compact reference returned by aggregate detail. */
function toReference(
  row: typeof initiative.$inferSelect,
  contextOrganizationId: string,
  organizationName: string,
) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationName,
    name: row.name,
    status: row.status,
    health: row.health,
    crossWorkspace: row.organizationId !== contextOrganizationId,
  };
}

/** Return a value proven by the relationship filter, or fail loudly if stored data breaks it. */
function requiredRelationshipValue<T>(value: T | undefined, message: string): T {
  /* v8 ignore next -- @preserve visibleLinks and rollupIds establish these lookups before use. */
  if (value === undefined) throw new Error(message);
  return value;
}

const MAX_RELATIONSHIP_LINKS = 200;
const MAX_RELATIONSHIP_NODES = 100;
const MAX_CONNECTED_WORK = 100;

/** Build only the hierarchy sections a reader asks for after opening a relationship tab. */
async function loadRelationshipSections(
  contextOrganizationId: string,
  id: string,
  session: AuthSession,
): Promise<z.input<typeof InitiativeRelationshipSections>> {
  const [linkRows, accessibleIds] = await Promise.all([
    db
      .select()
      .from(initiativeHierarchyLink)
      .where(eq(initiativeHierarchyLink.contextOrganizationId, contextOrganizationId))
      .orderBy(asc(initiativeHierarchyLink.id))
      .limit(MAX_RELATIONSHIP_LINKS + 1),
    accessibleInitiativeOrganizationIds(contextOrganizationId, session),
  ]);
  let truncated = linkRows.length > MAX_RELATIONSHIP_LINKS;
  const links = linkRows.slice(0, MAX_RELATIONSHIP_LINKS);
  const linkedIds = [
    ...new Set(links.flatMap((row) => [row.parentInitiativeId, row.childInitiativeId])),
  ];
  const candidateRows = await db
    .select()
    .from(initiative)
    .where(inArray(initiative.id, [...new Set([id, ...linkedIds])]));
  const rowsById = new Map(
    candidateRows
      .filter((row) => accessibleIds.has(row.organizationId))
      .map((row) => [row.id, row]),
  );
  const target = rowsById.get(id);
  const appearsInContext =
    target?.organizationId === contextOrganizationId ||
    links.some((row) => row.parentInitiativeId === id || row.childInitiativeId === id);
  if (!target || !appearsInContext) throw new NotFoundError('Initiative not found');

  const visibleLinks = links.filter(
    (row) => rowsById.has(row.parentInitiativeId) && rowsById.has(row.childInitiativeId),
  );
  const parentLink = visibleLinks.find((row) => row.childInitiativeId === id) ?? null;
  const childLinks = visibleLinks.filter((row) => row.parentInitiativeId === id);
  const childrenByParent = new Map<string, string[]>();
  for (const row of visibleLinks) {
    const children = childrenByParent.get(row.parentInitiativeId) ?? [];
    children.push(row.childInitiativeId);
    childrenByParent.set(row.parentInitiativeId, children);
  }
  const descendantIds: string[] = [];
  const inheritedThrough = new Map<string, string>();
  const visit = (parentId: string, firstHop: string): void => {
    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (descendantIds.includes(childId)) continue;
      if (descendantIds.length >= MAX_RELATIONSHIP_NODES) {
        truncated = true;
        return;
      }
      descendantIds.push(childId);
      inheritedThrough.set(childId, firstHop);
      visit(childId, firstHop);
    }
  };
  for (const child of childLinks) {
    if (descendantIds.length >= MAX_RELATIONSHIP_NODES) {
      truncated = true;
      break;
    }
    descendantIds.push(child.childInitiativeId);
    inheritedThrough.set(child.childInitiativeId, child.childInitiativeId);
    visit(child.childInitiativeId, child.childInitiativeId);
  }
  const rollupIds = [id, ...descendantIds];
  const [programLinks, projectLinks] = await Promise.all([
    db
      .select({ initiativeId: initiativeProgram.initiativeId, row: program })
      .from(initiativeProgram)
      .innerJoin(program, eq(program.id, initiativeProgram.programId))
      .where(inArray(initiativeProgram.initiativeId, rollupIds))
      .orderBy(asc(program.id))
      .limit(MAX_CONNECTED_WORK + 1),
    db
      .select({ initiativeId: initiativeProject.initiativeId, row: project })
      .from(initiativeProject)
      .innerJoin(project, eq(project.id, initiativeProject.projectId))
      .where(inArray(initiativeProject.initiativeId, rollupIds))
      .orderBy(asc(project.id))
      .limit(MAX_CONNECTED_WORK + 1),
  ]);
  if (programLinks.length > MAX_CONNECTED_WORK || projectLinks.length > MAX_CONNECTED_WORK)
    truncated = true;
  const connectedByKey = new Map<
    string,
    z.input<typeof InitiativeRelationshipSections>['connectedWork'][number]
  >();
  const inheritedThroughInitiativeId = (initiativeId: string): string | null => {
    if (initiativeId === id) return null;
    // Every non-root rollup id enters inheritedThrough before the connected-work queries run.
    return requiredRelationshipValue(
      inheritedThrough.get(initiativeId),
      'Initiative rollup child is missing its inheritance path',
    );
  };
  for (const item of programLinks) {
    if (!accessibleIds.has(item.row.organizationId)) continue;
    const key = `program:${item.row.id}`;
    const direct = item.initiativeId === id;
    const existing = connectedByKey.get(key);
    if (existing?.direct || (existing && !direct)) continue;
    connectedByKey.set(key, {
      kind: 'program',
      id: item.row.id,
      organizationId: item.row.organizationId,
      name: item.row.name,
      status: item.row.status,
      health: item.row.health,
      direct,
      inheritedThroughInitiativeId: inheritedThroughInitiativeId(item.initiativeId),
    });
  }
  for (const item of projectLinks) {
    if (!accessibleIds.has(item.row.organizationId)) continue;
    const key = `project:${item.row.id}`;
    const direct = item.initiativeId === id;
    const existing = connectedByKey.get(key);
    if (existing?.direct || (existing && !direct)) continue;
    connectedByKey.set(key, {
      kind: 'project',
      id: item.row.id,
      organizationId: item.row.organizationId,
      name: item.row.name,
      status: item.row.status,
      health: item.row.health,
      direct,
      inheritedThroughInitiativeId: inheritedThroughInitiativeId(item.initiativeId),
    });
  }
  const parentRow = parentLink ? rowsById.get(parentLink.parentInitiativeId) : null;
  const children = childLinks.map((link) => {
    // `childLinks` comes from `visibleLinks`, whose predicate requires this key in rowsById.
    const child = requiredRelationshipValue(
      rowsById.get(link.childInitiativeId),
      'Visible Initiative child is missing from the relationship index',
    );
    return { child, link };
  });
  if (children.length > MAX_RELATIONSHIP_NODES) truncated = true;
  const visibleChildren = children.slice(0, MAX_RELATIONSHIP_NODES);
  const connectedWork = [...connectedByKey.values()];
  if (connectedWork.length > MAX_CONNECTED_WORK) truncated = true;
  const visibleConnectedWork = connectedWork.slice(0, MAX_CONNECTED_WORK);
  const referenceOrganizationIds = [parentRow, ...visibleChildren.map(({ child }) => child)]
    .filter((row): row is typeof initiative.$inferSelect => row !== null && row !== undefined)
    .map((row) => row.organizationId);
  const orgRows =
    referenceOrganizationIds.length === 0
      ? []
      : await db
          .select({ id: organization.id, name: organization.name })
          .from(organization)
          .where(inArray(organization.id, [...new Set(referenceOrganizationIds)]));
  const orgNameById = new Map(orgRows.map((row) => [row.id, row.name]));
  return {
    contextOrganizationId,
    parentLinkId: parentLink?.id ?? null,
    parent: parentRow
      ? toReference(
          parentRow,
          contextOrganizationId,
          orgNameById.get(parentRow.organizationId) ?? '',
        )
      : null,
    children: visibleChildren.map(({ child, link }) => ({
      ...toReference(child, contextOrganizationId, orgNameById.get(child.organizationId) ?? ''),
      parentInitiativeId: id,
      parentLinkId: link.id,
    })),
    connectedWork: visibleConnectedWork,
    truncated,
  };
}

/** Aggregate Initiative router, mounted before the `/:id` core route. */
const initiativeAggregates = new Hono<AppEnv>()
  .get(
    '/overview',
    apiDoc({
      tag: 'Initiatives',
      summary: 'Get the Initiative hierarchy and attention queue',
      description:
        'Returns the viewer-visible Initiative hierarchy for this workspace context together with up to four deduplicated attention items ranked by health severity and update staleness.',
      response: InitiativeOverviewOut,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const [contextInitiatives, links, accessibleIds] = await Promise.all([
        db.select().from(initiative).where(eq(initiative.organizationId, orgId)),
        db
          .select()
          .from(initiativeHierarchyLink)
          .where(eq(initiativeHierarchyLink.contextOrganizationId, orgId)),
        accessibleInitiativeOrganizationIds(orgId, c.get('session')),
      ]);
      const linkedIds = links.flatMap((link) => [link.parentInitiativeId, link.childInitiativeId]);
      const linkedInitiatives =
        linkedIds.length === 0
          ? []
          : await db.select().from(initiative).where(inArray(initiative.id, linkedIds));
      const rowsById = new Map(
        [...contextInitiatives, ...linkedInitiatives]
          .filter((row) => accessibleIds.has(row.organizationId))
          .map((row) => [row.id, row]),
      );
      const visibleLinks = links.filter(
        (link) => rowsById.has(link.parentInitiativeId) && rowsById.has(link.childInitiativeId),
      );
      const visibleRows = [...rowsById.values()];
      const visibleIds = visibleRows.map((row) => row.id);
      const organizationIds = [...new Set(visibleRows.map((row) => row.organizationId))];
      const [orgRows, ownerRows, updateRows, displayRows] = await Promise.all([
        organizationIds.length === 0
          ? []
          : db
              .select({ id: organization.id, name: organization.name })
              .from(organization)
              .where(inArray(organization.id, organizationIds)),
        db
          .select({ id: actor.id, displayName: actor.displayName })
          .from(actor)
          .where(
            inArray(
              actor.id,
              visibleRows.flatMap((row) => (row.ownerId ? [row.ownerId] : [])),
            ),
          ),
        visibleIds.length === 0 || organizationIds.length === 0
          ? []
          : db
              .select()
              .from(update)
              .where(
                and(
                  eq(update.subjectType, 'initiative'),
                  inArray(update.subjectId, visibleIds),
                  inArray(update.organizationId, organizationIds),
                ),
              )
              .orderBy(desc(update.createdAt), desc(update.id)),
        visibleIds.length === 0 || organizationIds.length === 0
          ? []
          : db
              .select()
              .from(entityDisplay)
              .where(
                and(
                  eq(entityDisplay.subjectType, 'initiative'),
                  inArray(entityDisplay.subjectId, visibleIds),
                  inArray(entityDisplay.organizationId, organizationIds),
                ),
              ),
      ]);
      const orgNameById = new Map(orgRows.map((row) => [row.id, row.name]));
      const ownerNameById = new Map(ownerRows.map((row) => [row.id, row.displayName]));
      const latestUpdateByInitiative = new Map<string, (typeof updateRows)[number]>();
      const displayByInitiative = new Map(
        displayRows
          .filter((row) => rowsById.get(row.subjectId)?.organizationId === row.organizationId)
          .map((row) => [row.subjectId, row]),
      );
      for (const row of updateRows) {
        if (rowsById.get(row.subjectId)?.organizationId !== row.organizationId) continue;
        if (!latestUpdateByInitiative.has(row.subjectId)) {
          latestUpdateByInitiative.set(row.subjectId, row);
        }
      }
      const parentByChild = new Map(
        visibleLinks.map((link) => [link.childInitiativeId, link.parentInitiativeId]),
      );
      const parentLinkByChild = new Map(
        visibleLinks.map((link) => [link.childInitiativeId, link.id]),
      );
      const childrenByParent = new Map<string, string[]>();
      for (const link of visibleLinks) {
        const children = childrenByParent.get(link.parentInitiativeId) ?? [];
        children.push(link.childInitiativeId);
        childrenByParent.set(link.parentInitiativeId, children);
      }
      const overviewItems: {
        row: (typeof visibleRows)[number];
        parentInitiativeId: string | null;
        parentLinkId: string | null;
        depth: number;
      }[] = [];
      const visit = (id: string, depth: number): void => {
        const row = rowsById.get(id);
        /* v8 ignore next -- @preserve defensive: `id` is always either a contextInitiatives row
         * (always in rowsById, filtered from the viewer's own org) or a visibleLinks child
         * (rowsById.has(child) is part of the visibleLinks filter itself), so this never misses. */
        if (!row) return;
        overviewItems.push({
          row,
          parentInitiativeId: parentByChild.get(id) ?? null,
          parentLinkId: parentLinkByChild.get(id) ?? null,
          depth,
        });
        const children = childrenByParent.get(id) ?? [];
        children
          .sort((a, b) => {
            // Same invariant as above: every id here came from visibleLinks, so both lookups
            // always resolve to a real row with a real name — the `?? ''` never fires.
            /* v8 ignore start -- @preserve defensive: see the invariant note above */
            const left = rowsById.get(a)?.name ?? '';
            const right = rowsById.get(b)?.name ?? '';
            /* v8 ignore stop */
            return left.localeCompare(right);
          })
          .forEach((childId) => {
            visit(childId, depth + 1);
          });
      };
      contextInitiatives
        .filter((row) => !parentByChild.has(row.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((row) => {
          visit(row.id, 1);
        });

      const attention = rankInitiativeAttention(
        overviewItems.map(({ row }) => ({
          id: row.id,
          status: row.status,
          health: row.health,
          updateCadence: row.updateCadence,
          createdAt: row.createdAt,
          lastUpdateAt: latestUpdateByInitiative.get(row.id)?.createdAt ?? null,
        })),
        new Date(),
      ).map(({ candidate, severity, action }) => {
        const row = rowsById.get(candidate.id);
        /* v8 ignore next -- @preserve candidates are constructed from rowsById above */
        if (!row) throw new Error('Initiative attention row disappeared');
        const parentId = parentByChild.get(row.id) ?? null;
        const latest = latestUpdateByInitiative.get(row.id);
        // `organizationIds` (fed into the orgRows query above) is built from the same rowsById
        // set as `row`, so a row's own org always has a matching entry — the `?? ''` fallback
        // exists only to satisfy Map's `| undefined` return type.
        /* v8 ignore next -- @preserve defensive: see the invariant note above */
        const organizationName = orgNameById.get(row.organizationId) ?? '';
        // `parentId` (when non-null) always came from `visibleLinks`, whose filter requires
        // both ends to already be in `rowsById` — so a resolved parent always has a real name.
        let parentInitiativeName: string | null = null;
        if (parentId) {
          /* v8 ignore next -- @preserve defensive: see the invariant note above */
          parentInitiativeName = rowsById.get(parentId)?.name ?? null;
        }
        return {
          initiativeId: row.id,
          organizationId: row.organizationId,
          organizationName,
          parentInitiativeId: parentId,
          parentInitiativeName,
          title: row.name,
          excerpt: latest?.body ?? row.summary,
          severity,
          action,
          lastUpdateAt: latest?.createdAt.toISOString() ?? null,
        };
      });
      return ok(c, InitiativeOverviewOut, {
        items: overviewItems.map(({ row, parentInitiativeId, parentLinkId, depth }) => {
          const display = displayByInitiative.get(row.id);
          // `ownerRows` (fed into ownerNameById above) is queried for exactly the ownerIds
          // present on visible rows, and an owner's `onDelete: 'set null'` FK means a set
          // ownerId always still names a real actor — the `?? null` fallback never fires.
          let ownerName: string | null = null;
          if (row.ownerId) {
            /* v8 ignore next -- @preserve defensive: see the invariant note above */
            ownerName = ownerNameById.get(row.ownerId) ?? null;
          }
          return {
            ...toOut(row),
            display: display
              ? {
                  subjectType: 'initiative' as const,
                  subjectId: row.id,
                  iconKey: display.iconKey,
                  colorKey: display.colorKey,
                  customColor: display.customColor,
                  coverImage: display.coverImage,
                  customized: true,
                }
              : defaultEntityDisplay('initiative', row.id),
            // Same org-id invariant as the attention list above.
            /* v8 ignore next -- @preserve defensive: see the invariant note above */
            organizationName: orgNameById.get(row.organizationId) ?? '',
            parentInitiativeId,
            parentLinkId,
            depth,
            childCount: childrenByParent.get(row.id)?.length ?? 0,
            ownerName,
            lastUpdateAt: latestUpdateByInitiative.get(row.id)?.createdAt.toISOString() ?? null,
          };
        }),
        attention,
      });
    },
  )
  .get(
    '/:id/relationships',
    apiDoc({
      tag: 'Initiatives',
      summary: 'Get deferred Initiative relationship sections',
      description:
        'Returns only the selected Initiative hierarchy context and connected work after a reader opens one of those tabs. It excludes labels, resources, updates, and organization rosters.',
      response: InitiativeRelationshipSections,
    }),
    zParam(z.object({ id: InitiativeId })),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      return ok(
        c,
        InitiativeRelationshipSections,
        await loadRelationshipSections(orgId, id, c.get('session')),
      );
    },
  )
  .get(
    '/:id/aggregate-detail',
    apiDoc({
      tag: 'Initiatives',
      summary: 'Get the bounded Initiative detail aggregate',
      description:
        'Returns the Initiative snapshot, visible-control capabilities, its named owner, and direct rollup content in one request. Hierarchy, updates, resources, and pickers load only when opened.',
      response: InitiativeDetailAggregate,
    }),
    zParam(z.object({ id: InitiativeId })),
    async (c) => {
      const { orgId, actorId, capabilities } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadInitiative(orgId, id);
      const [summary, ownerRows] = await Promise.all([
        associatedWorkSummary(orgId, id),
        row.ownerId === null
          ? Promise.resolve([])
          : db
              .select()
              .from(actor)
              .where(and(eq(actor.id, row.ownerId), eq(actor.organizationId, orgId)))
              .limit(1),
      ]);
      const owner = ownerRows[0];

      return ok(c, InitiativeDetailAggregate, {
        target: 'initiative',
        snapshot: {
          target: 'initiative',
          organizationId: row.organizationId,
          id: row.id,
          name: row.name,
          status: row.status,
          priority: row.priority,
          health: row.health,
          updatedAt: row.updatedAt.toISOString(),
        },
        viewer: { actorId },
        capabilities: detailCapabilities(capabilities),
        references: owner
          ? { owner: { actorId: owner.id, displayName: owner.displayName, avatar: owner.avatar } }
          : { owner: null },
        defaultView: { initiative: buildInitiativeDetailFromSummary(row, summary) },
      });
    },
  )
  .get(
    '/:id/aggregate',
    apiDoc({
      tag: 'Initiatives',
      summary: 'Get the aggregate Initiative document detail',
      description:
        'Returns the Initiative document and properties plus its visible hierarchy context, connected work rollups, labels, resources, and latest narrative update for this viewer.',
      response: InitiativeAggregateDetail,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const id = c.req.param('id');
      const [links, accessibleIds] = await Promise.all([
        db
          .select()
          .from(initiativeHierarchyLink)
          .where(eq(initiativeHierarchyLink.contextOrganizationId, orgId)),
        accessibleInitiativeOrganizationIds(orgId, c.get('session')),
      ]);
      const linkedIds = [
        ...new Set(links.flatMap((row) => [row.parentInitiativeId, row.childInitiativeId])),
      ];
      const candidateIds = [...new Set([id, ...linkedIds])];
      const candidateRows = await db
        .select()
        .from(initiative)
        .where(inArray(initiative.id, candidateIds));
      const rowsById = new Map(
        candidateRows
          .filter((row) => accessibleIds.has(row.organizationId))
          .map((row) => [row.id, row]),
      );
      const target = rowsById.get(id);
      const appearsInContext =
        target?.organizationId === orgId ||
        links.some((row) => row.parentInitiativeId === id || row.childInitiativeId === id);
      if (!target || !appearsInContext) throw new NotFoundError('Initiative not found');

      const visibleLinks = links.filter(
        (row) => rowsById.has(row.parentInitiativeId) && rowsById.has(row.childInitiativeId),
      );
      const parentLink = visibleLinks.find((row) => row.childInitiativeId === id) ?? null;
      const childLinks = visibleLinks.filter((row) => row.parentInitiativeId === id);
      const childrenByParent = new Map<string, string[]>();
      for (const row of visibleLinks) {
        const children = childrenByParent.get(row.parentInitiativeId) ?? [];
        children.push(row.childInitiativeId);
        childrenByParent.set(row.parentInitiativeId, children);
      }
      const descendantIds: string[] = [];
      const inheritedThrough = new Map<string, string>();
      const visit = (parentId: string, firstHop: string): void => {
        for (const childId of childrenByParent.get(parentId) ?? []) {
          // `childrenByParent` is built from `visibleLinks` within ONE context, where the
          // `initiative_hierarchy_context_child_uq` unique index guarantees a child has at most
          // one parent edge — combined with the cycle guard on link creation, the reachable
          // graph below `id` is a proper forest, so no descendant is ever visited twice.
          /* v8 ignore next -- @preserve defensive: see the invariant note above */
          if (descendantIds.includes(childId)) continue;
          descendantIds.push(childId);
          inheritedThrough.set(childId, firstHop);
          visit(childId, firstHop);
        }
      };
      for (const child of childLinks) {
        descendantIds.push(child.childInitiativeId);
        inheritedThrough.set(child.childInitiativeId, child.childInitiativeId);
        visit(child.childInitiativeId, child.childInitiativeId);
      }
      const rollupIds = [id, ...descendantIds];

      const [programLinks, projectLinks, labelLinks, resourceRows, updateRows, orgRows] =
        await Promise.all([
          db
            .select({ initiativeId: initiativeProgram.initiativeId, row: program })
            .from(initiativeProgram)
            .innerJoin(program, eq(program.id, initiativeProgram.programId))
            .where(inArray(initiativeProgram.initiativeId, rollupIds)),
          db
            .select({ initiativeId: initiativeProject.initiativeId, row: project })
            .from(initiativeProject)
            .innerJoin(project, eq(project.id, initiativeProject.projectId))
            .where(inArray(initiativeProject.initiativeId, rollupIds)),
          db
            .select({ row: label })
            .from(initiativeLabel)
            .innerJoin(label, eq(label.id, initiativeLabel.labelId))
            .where(eq(initiativeLabel.initiativeId, id)),
          db
            .select()
            .from(attachment)
            .where(
              and(
                eq(attachment.organizationId, target.organizationId),
                eq(attachment.subjectType, 'initiative'),
                eq(attachment.subjectId, id),
                eq(attachment.kind, 'url'),
              ),
            ),
          db
            .select()
            .from(update)
            .where(
              and(
                eq(update.organizationId, target.organizationId),
                eq(update.subjectType, 'initiative'),
                eq(update.subjectId, id),
              ),
            )
            .orderBy(desc(update.createdAt), desc(update.id)),
          db
            .select({ id: organization.id, name: organization.name })
            .from(organization)
            .where(inArray(organization.id, [...accessibleIds])),
        ]);
      const orgNameById = new Map(orgRows.map((row) => [row.id, row.name]));
      const connectedByKey = new Map<
        string,
        z.input<typeof InitiativeAggregateDetail>['connectedWork'][number]
      >();
      /**
       * The first hop below `id` an indirect (non-direct) connected-work link inherited through,
       * or `null` for a direct link.
       *
       * @remarks
       * `programLinks`/`projectLinks` are queried for exactly `rollupIds = [id, ...descendantIds]`,
       * so an `initiativeId` that is not `id` itself is always one of `descendantIds` — and
       * `inheritedThrough` is populated for every one of those during the traversal above. The
       * `?? null` exists only to satisfy Map's `| undefined` return type.
       */
      function inheritedThroughInitiativeId(initiativeId: string): string | null {
        if (initiativeId === id) return null;
        /* v8 ignore next -- @preserve defensive: see the function's own remarks */
        return inheritedThrough.get(initiativeId) ?? null;
      }
      for (const item of programLinks) {
        if (!accessibleIds.has(item.row.organizationId)) continue;
        const key = `program:${item.row.id}`;
        const direct = item.initiativeId === id;
        const existing = connectedByKey.get(key);
        if (existing?.direct || (existing && !direct)) continue;
        connectedByKey.set(key, {
          kind: 'program',
          id: item.row.id,
          organizationId: item.row.organizationId,
          name: item.row.name,
          status: item.row.status,
          health: item.row.health,
          direct,
          inheritedThroughInitiativeId: inheritedThroughInitiativeId(item.initiativeId),
        });
      }
      for (const item of projectLinks) {
        if (!accessibleIds.has(item.row.organizationId)) continue;
        const key = `project:${item.row.id}`;
        const direct = item.initiativeId === id;
        const existing = connectedByKey.get(key);
        if (existing?.direct || (existing && !direct)) continue;
        connectedByKey.set(key, {
          kind: 'project',
          id: item.row.id,
          organizationId: item.row.organizationId,
          name: item.row.name,
          status: item.row.status,
          health: item.row.health,
          direct,
          inheritedThroughInitiativeId: inheritedThroughInitiativeId(item.initiativeId),
        });
      }
      const connectedWork = [...connectedByKey.values()];
      const programs = connectedWork
        .filter((row) => row.kind === 'program')
        .map((row) => ({ health: row.health }));
      const projects = connectedWork
        .filter((row) => row.kind === 'project')
        .map((row) => ({ health: row.health }));
      const baseDetail = buildInitiativeDetail(target, projects, programs);
      const latest = updateRows[0] ?? null;
      const parentRow = parentLink ? rowsById.get(parentLink.parentInitiativeId) : null;
      // `parentRow`'s and every child's `organizationId` is always within `accessibleIds` (both
      // came from `rowsById`, which is filtered to `accessibleIds.has(row.organizationId)`), and
      // `orgRows` above was queried for exactly `[...accessibleIds]` — so `orgNameById.get(...)`
      // always finds a name and `rowsById.get(link.childInitiativeId)` (from `childLinks`, a
      // subset of `visibleLinks`, whose filter requires both ends in `rowsById`) never misses.
      let parent: z.input<typeof InitiativeAggregateDetail>['parent'] = null;
      if (parentRow) {
        /* v8 ignore next -- @preserve defensive: see the invariant note above */
        parent = toReference(parentRow, orgId, orgNameById.get(parentRow.organizationId) ?? '');
      }
      /* v8 ignore next 4 -- @preserve defensive: see the invariant note above */
      const children = childLinks.flatMap((link) => {
        const child = rowsById.get(link.childInitiativeId);
        return child
          ? [
              {
                ...toReference(child, orgId, orgNameById.get(child.organizationId) ?? ''),
                parentInitiativeId: id,
                parentLinkId: link.id,
              },
            ]
          : [];
      });
      return ok(c, InitiativeAggregateDetail, {
        ...baseDetail,
        contextOrganizationId: orgId,
        parentLinkId: parentLink?.id ?? null,
        parent,
        children,
        connectedWork,
        truncated: false,
        labels: labelLinks.map(({ row }) => ({
          id: row.id,
          organizationId: row.organizationId,
          name: row.name,
          color: row.color,
          groupId: row.groupId,
          teamId: row.teamId,
          external: row.externalId != null,
          createdAt: row.createdAt.toISOString(),
        })),
        resources: resourceRows.map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          kind: row.kind,
          title: row.title,
          url: row.url,
          sourceIntegrationId: row.sourceIntegrationId,
          externalId: row.externalId,
          metadata: row.metadata as Record<string, unknown> | null,
          fileName: row.fileName,
          mimeType: row.mimeType,
          byteSize: row.byteSize,
          createdAt: row.createdAt.toISOString(),
        })),
        latestUpdate: latest
          ? {
              id: latest.id,
              organizationId: latest.organizationId,
              authorId: latest.authorId,
              subjectType: latest.subjectType,
              subjectId: latest.subjectId,
              health: latest.health,
              body: latest.body,
              createdAt: latest.createdAt.toISOString(),
            }
          : null,
        updateCount: updateRows.length,
      });
    },
  );

export default initiativeAggregates;
