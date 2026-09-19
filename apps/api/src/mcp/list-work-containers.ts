/**
 * `@docket/api` — the project, program and initiative branch of the `list_work` query.
 *
 * @remarks
 * The three containers share a much smaller filter set than tasks do, and none of them carries a
 * per-row visibility predicate, so one query serves the whole page.
 */
import {
  db,
  initiative,
  initiativeLabel,
  initiativeProgram,
  initiativeProject,
  program,
  project,
  projectLabel,
} from '@docket/db';
import { and, desc, eq, exists, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { resolveDescriptor } from './descriptors';
import { entityHref } from './entity-href';
import { seekAfter } from './list-work-seek';
import {
  anyValue,
  type ContainerQuery,
  type ListWorkInput,
  type WorkEntity,
  type WorkPageRow,
} from './list-work-contract';

/** One listable container entity. */
type ContainerEntity = Exclude<WorkEntity, 'task'>;

/** The table a container entity lives in. */
function containerTable(
  entity: ContainerEntity,
): typeof project | typeof program | typeof initiative {
  return { project, program, initiative }[entity];
}

/** The team, program and lead filters, which only projects carry columns for. */
async function projectScopeFilters(
  orgId: string,
  input: ListWorkInput,
): Promise<(SQL | undefined)[]> {
  const filters: (SQL | undefined)[] = [];
  if (input.team !== undefined) {
    filters.push(eq(project.teamId, await resolveDescriptor(orgId, 'team', input.team, 'team')));
  }
  if (input.program !== undefined) {
    filters.push(
      eq(project.programId, await resolveDescriptor(orgId, 'program', input.program, 'program')),
    );
  }
  if (input.lead !== undefined) {
    filters.push(eq(project.leadId, await resolveDescriptor(orgId, 'actor', input.lead, 'lead')));
  }
  return filters;
}

/**
 * Match containers that roll up to one initiative.
 *
 * @remarks
 * Both projects and programs roll up to initiatives, through their own join table. This lived
 * inside the project branch and was therefore declared-but-unapplied for programs — a filter
 * silently doing nothing is the one failure this module exists to prevent, since it hands the
 * caller a confidently wrong answer rather than an error.
 *
 * @param orgId - The organization to resolve within.
 * @param entity - What is being listed.
 * @param descriptor - The initiative the caller named.
 * @returns the predicate.
 */
async function initiativeRollupFilter(
  orgId: string,
  entity: 'project' | 'program',
  descriptor: string,
): Promise<SQL> {
  const initiativeId = await resolveDescriptor(orgId, 'initiative', descriptor, 'initiative');
  const link =
    entity === 'project'
      ? {
          table: initiativeProject,
          member: initiativeProject.projectId,
          own: project.id,
          initiativeId: initiativeProject.initiativeId,
        }
      : {
          table: initiativeProgram,
          member: initiativeProgram.programId,
          own: program.id,
          initiativeId: initiativeProgram.initiativeId,
        };
  return exists(
    db
      .select({ one: sql`1` })
      .from(link.table)
      .where(and(eq(link.member, link.own), eq(link.initiativeId, initiativeId))),
  );
}

/**
 * Match containers carrying one label.
 *
 * @remarks
 * Projects and initiatives carry labels through their own join tables; programs do not, which is
 * why `label` is absent from their entry in the supported-filter table rather than accepted and
 * ignored here.
 *
 * @param orgId - The organization to resolve within.
 * @param entity - What is being listed.
 * @param descriptor - The label the caller named.
 * @returns the predicate.
 */
async function containerLabelFilter(
  orgId: string,
  entity: 'project' | 'initiative',
  descriptor: string,
): Promise<SQL> {
  const labelId = await resolveDescriptor(orgId, 'label', descriptor, 'label');
  const link =
    entity === 'project'
      ? {
          table: projectLabel,
          member: projectLabel.projectId,
          own: project.id,
          label: projectLabel.labelId,
        }
      : {
          table: initiativeLabel,
          member: initiativeLabel.initiativeId,
          own: initiative.id,
          label: initiativeLabel.labelId,
        };
  return exists(
    db
      .select({ one: sql`1` })
      .from(link.table)
      .where(and(eq(link.member, link.own), eq(link.label, labelId))),
  );
}

/** The archival, status and freshness predicates, which every container entity carries. */
function containerBaseFilters(
  orgId: string,
  entity: ContainerEntity,
  input: ListWorkInput,
): (SQL | undefined)[] {
  const table = containerTable(entity);
  const where: (SQL | undefined)[] = [
    eq(table.organizationId, orgId),
    input.archived === true ? isNotNull(table.archivedAt) : isNull(table.archivedAt),
  ];
  if (Array.isArray(input.status) && input.status.length > 0) {
    where.push(anyValue(table.status, input.status));
  }
  if (input.updatedAfter !== undefined) {
    where.push(gte(table.updatedAt, new Date(input.updatedAfter)));
  }
  return where;
}

/**
 * Assemble every predicate a container query runs under, apart from the keyset position.
 *
 * @param orgId - The organization to list within.
 * @param entity - What is being listed.
 * @param input - The caller's filters, already checked for applicability.
 * @returns the predicates, in no significant order.
 */
async function containerWhere(
  orgId: string,
  entity: ContainerEntity,
  input: ListWorkInput,
): Promise<(SQL | undefined)[]> {
  const where = containerBaseFilters(orgId, entity, input);
  if (entity === 'project') where.push(...(await projectScopeFilters(orgId, input)));
  if (input.initiative !== undefined && entity !== 'initiative') {
    where.push(await initiativeRollupFilter(orgId, entity, input.initiative));
  }
  if (entity !== 'project' && input.owner !== undefined) {
    const ownerId = await resolveDescriptor(orgId, 'actor', input.owner, 'owner');
    where.push(eq(entity === 'program' ? program.ownerId : initiative.ownerId, ownerId));
  }
  if (input.label !== undefined && entity !== 'program') {
    where.push(await containerLabelFilter(orgId, entity, input.label));
  }
  return where;
}

/** The planning-date columns a container entity carries, which differ across all three. */
function containerDateColumns(entity: ContainerEntity) {
  switch (entity) {
    case 'project':
      return {
        startDate: project.startDate,
        startDateResolution: project.startDateResolution,
        startDateFiscalYearStartMonth: project.startDateFiscalYearStartMonth,
        targetDate: project.targetDate,
        targetDateResolution: project.targetDateResolution,
        targetDateFiscalYearStartMonth: project.targetDateFiscalYearStartMonth,
      };
    case 'initiative':
      return {
        targetDate: initiative.targetDate,
        targetDateResolution: initiative.targetDateResolution,
        targetDateFiscalYearStartMonth: initiative.targetDateFiscalYearStartMonth,
      };
    case 'program':
      return {};
  }
}

/** Build and run the project/program/initiative query. */
export async function listContainers(query: ContainerQuery): Promise<WorkPageRow[]> {
  const { orgId, entity, input, limit, after } = query;
  const table = containerTable(entity);
  const where = await containerWhere(orgId, entity, input);

  const rows = await db
    .select({
      id: table.id,
      title: table.name,
      status: table.status,
      createdAt: table.createdAt,
      ...containerDateColumns(entity),
    })
    .from(table)
    .where(and(...where, seekAfter(table.createdAt, table.id, after)))
    .orderBy(desc(table.createdAt), desc(table.id))
    .limit(limit + 1);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    href: entityHref(orgId, entity, row.id),
    status: row.status,
    createdAt: row.createdAt,
    ...('startDate' in row
      ? {
          startDate: row.startDate?.toISOString() ?? null,
          startDateResolution: row.startDateResolution,
          startDateFiscalYearStartMonth: row.startDateFiscalYearStartMonth,
        }
      : {}),
    ...('targetDate' in row
      ? {
          targetDate: row.targetDate?.toISOString() ?? null,
          targetDateResolution: row.targetDateResolution,
          targetDateFiscalYearStartMonth: row.targetDateFiscalYearStartMonth,
        }
      : {}),
  }));
}
