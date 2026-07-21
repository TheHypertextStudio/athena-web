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
  InitiativeOverviewOut,
} from '@docket/types';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { rankInitiativeAttention } from './initiative-attention';
import { accessibleInitiativeOrganizationIds } from './initiative-hierarchy';
import { buildInitiativeDetail, toOut } from './initiative-helpers';

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
        if (!row) return;
        overviewItems.push({
          row,
          parentInitiativeId: parentByChild.get(id) ?? null,
          parentLinkId: parentLinkByChild.get(id) ?? null,
          depth,
        });
        const children = childrenByParent.get(id) ?? [];
        children
          .sort((a, b) => (rowsById.get(a)?.name ?? '').localeCompare(rowsById.get(b)?.name ?? ''))
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
        return {
          initiativeId: row.id,
          organizationId: row.organizationId,
          organizationName: orgNameById.get(row.organizationId) ?? '',
          parentInitiativeId: parentId,
          parentInitiativeName: parentId ? (rowsById.get(parentId)?.name ?? null) : null,
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
          return {
            ...toOut(row),
            display: display
              ? {
                  subjectType: 'initiative' as const,
                  subjectId: row.id,
                  iconKey: display.iconKey,
                  colorKey: display.colorKey,
                  customized: true,
                }
              : defaultEntityDisplay('initiative', row.id),
            organizationName: orgNameById.get(row.organizationId) ?? '',
            parentInitiativeId,
            parentLinkId,
            depth,
            childCount: childrenByParent.get(row.id)?.length ?? 0,
            ownerName: row.ownerId ? (ownerNameById.get(row.ownerId) ?? null) : null,
            lastUpdateAt: latestUpdateByInitiative.get(row.id)?.createdAt.toISOString() ?? null,
          };
        }),
        attention,
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
          inheritedThroughInitiativeId:
            item.initiativeId === id ? null : (inheritedThrough.get(item.initiativeId) ?? null),
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
          inheritedThroughInitiativeId:
            item.initiativeId === id ? null : (inheritedThrough.get(item.initiativeId) ?? null),
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
      return ok(c, InitiativeAggregateDetail, {
        ...baseDetail,
        contextOrganizationId: orgId,
        parent: parentRow
          ? toReference(parentRow, orgId, orgNameById.get(parentRow.organizationId) ?? '')
          : null,
        children: childLinks.flatMap((link) => {
          const child = rowsById.get(link.childInitiativeId);
          return child
            ? [toReference(child, orgId, orgNameById.get(child.organizationId) ?? '')]
            : [];
        }),
        connectedWork,
        labels: labelLinks.map(({ row }) => ({
          id: row.id,
          organizationId: row.organizationId,
          name: row.name,
          color: row.color,
          group: row.group,
          teamId: row.teamId,
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
