/** Load one workspace's visible graph with batched canonical authorization. */
import {
  db,
  initiative,
  initiativeHierarchyLink,
  initiativeProgram,
  initiativeProject,
  program,
  project,
  projectDependency,
  task,
  taskDependency,
  workStatus,
} from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { graphViewableKeys } from './access';
import { buildTaskViewFilter } from '../routes/task-helpers';
import { entityHref } from '../mcp/entity-href';
import type { GraphData, GraphRelation, GraphWork } from './contract';

async function readRows(orgId: string) {
  const active = (table: typeof task | typeof project | typeof program | typeof initiative) =>
    and(eq(table.organizationId, orgId), isNull(table.archivedAt));
  const [tasks, projects, programs, initiatives, statuses] = await Promise.all([
    db.select().from(task).where(active(task)),
    db.select().from(project).where(active(project)),
    db.select().from(program).where(active(program)),
    db.select().from(initiative).where(active(initiative)),
    db.select().from(workStatus).where(eq(workStatus.organizationId, orgId)),
  ]);
  return { tasks, projects, programs, initiatives, statuses };
}

async function readRelations(orgId: string): Promise<GraphRelation[]> {
  const [tasks, projects, hierarchy, programs, initiatives] = await Promise.all([
    db.select().from(taskDependency).where(eq(taskDependency.organizationId, orgId)),
    db.select().from(projectDependency).where(eq(projectDependency.organizationId, orgId)),
    db
      .select()
      .from(initiativeHierarchyLink)
      .where(eq(initiativeHierarchyLink.contextOrganizationId, orgId)),
    db.select().from(initiativeProgram).where(eq(initiativeProgram.organizationId, orgId)),
    db.select().from(initiativeProject).where(eq(initiativeProject.organizationId, orgId)),
  ]);
  return [
    ...tasks.map((r) => ({
      source: `task:${r.blockingTaskId}`,
      target: `task:${r.blockedTaskId}`,
      kind: 'task_dependency' as const,
    })),
    ...projects.map((r) => ({
      source: `project:${r.blockingProjectId}`,
      target: `project:${r.blockedProjectId}`,
      kind: 'project_dependency' as const,
    })),
    ...hierarchy.map((r) => ({
      source: `initiative:${r.parentInitiativeId}`,
      target: `initiative:${r.childInitiativeId}`,
      kind: 'contains' as const,
    })),
    ...programs.map((r) => ({
      source: `initiative:${r.initiativeId}`,
      target: `program:${r.programId}`,
      kind: 'contributes' as const,
    })),
    ...initiatives.map((r) => ({
      source: `initiative:${r.initiativeId}`,
      target: `project:${r.projectId}`,
      kind: 'contributes' as const,
    })),
  ];
}

function placementRelations(rows: Awaited<ReturnType<typeof readRows>>): GraphRelation[] {
  const edges: GraphRelation[] = [];
  const add = (source: string, target: string) => edges.push({ source, target, kind: 'contains' });
  for (const t of rows.tasks) {
    if (t.projectId) add(`project:${t.projectId}`, `task:${t.id}`);
    else if (t.programId) add(`program:${t.programId}`, `task:${t.id}`);
    if (t.parentTaskId) add(`task:${t.parentTaskId}`, `task:${t.id}`);
  }
  for (const p of rows.projects) if (p.programId) add(`program:${p.programId}`, `project:${p.id}`);
  return edges;
}

/** Read live authorized nodes and relationships; denied objects never reach projection or counts. */
export async function readGraphData(orgId: string, actorId: string): Promise<GraphData> {
  const [rows, relations, canViewTask] = await Promise.all([
    readRows(orgId),
    readRelations(orgId),
    buildTaskViewFilter(orgId, actorId),
  ]);
  const statuses = new Map(rows.statuses.map((s) => [s.id, s]));
  const nodes: GraphWork[] = [];
  const add = (
    kind: GraphWork['kind'],
    row: { id: string; statusId: string; priority?: string | null },
    title: string,
  ) => {
    const status = statuses.get(row.statusId);
    if (status)
      nodes.push({
        key: `${kind}:${row.id}`,
        id: row.id,
        kind,
        title,
        status: status.name,
        category: status.category,
        priority: row.priority ?? 'none',
        href: entityHref(orgId, kind, row.id),
      });
  };
  for (const t of rows.tasks.filter(canViewTask)) add('task', t, t.title);
  for (const p of rows.projects) add('project', p, p.name);
  for (const p of rows.programs) add('program', p, p.name);
  for (const i of rows.initiatives) add('initiative', i, i.name);
  const keys = await graphViewableKeys({ orgId, actorId }, nodes);
  const visible = nodes.filter((n) => n.kind === 'task' || keys.has(n.key));
  const allowed = new Set(visible.map((n) => n.key));
  return {
    nodes: visible,
    relations: [...relations, ...placementRelations(rows)].filter(
      (r) => allowed.has(r.source) && allowed.has(r.target),
    ),
  };
}
