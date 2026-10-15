import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { ProcessDefinitionCreate, RecurrenceSeriesCreate } from '../../src/contracts/recurrence';
import type processRouter from '../../src/routes/process-definitions';
import type recurrenceRouter from '../../src/routes/recurrence-series';
import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';
import {
  createRecurrenceSeries,
  materializeSeriesOccurrence,
} from '../../src/lib/recurrence/series';
import { appWithActor, one, seedProgram, seedTask } from '../support/routes-harness';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';
import type { McpContext } from '../../src/mcp/auth';

async function seedOtherActor(
  schema: typeof DbModule,
  seed: Awaited<ReturnType<typeof seedMcpUpdateOrg>>,
) {
  await schema.db.insert(schema.grant).values({
    organizationId: seed.orgId,
    subjectKind: 'actor',
    subjectId: seed.sarahId,
    resourceKind: 'organization',
    resourceId: seed.orgId,
    capabilities: ['view', 'contribute'],
    effect: 'allow',
    cascades: false,
  });
  const user = one(
    await schema.db
      .insert(schema.user)
      .values({ name: 'Sarah', email: `legacy-${seed.sarahId}@example.test` })
      .returning(),
  );
  await schema.db
    .update(schema.actor)
    .set({ userId: user.id })
    .where(eq(schema.actor.id, seed.sarahId));
  const otherContext: McpContext = {
    principal: { kind: 'user', userId: user.id, userName: user.name, userEmail: user.email },
    scopes: ['work:read', 'work:write'],
  };
  const program = await seedProgram(schema.db, schema, seed.statusId, {
    organizationId: seed.orgId,
    name: 'Managed Program',
    createdBy: seed.actorId,
  });
  await schema.db.insert(schema.grant).values({
    organizationId: seed.orgId,
    subjectKind: 'actor',
    subjectId: seed.sarahId,
    resourceKind: 'program',
    resourceId: program.id,
    capabilities: ['manage'],
    effect: 'allow',
    cascades: true,
  });
  return { program, otherContext };
}
/** Real owner, same-workspace contributor and unrelated Program manager with distinct persisted grants. */
export async function legacyPrivacyFixture(
  schema: typeof DbModule,
  processes: typeof processRouter,
  recurrence: typeof recurrenceRouter,
) {
  const seed = await seedMcpUpdateOrg(schema.db, schema, ['manage']);
  const { program, otherContext } = await seedOtherActor(schema, seed);
  const definition = ProcessDefinitionCreate.parse({
    name: 'PRIVATE DINNER PROCESS',
    description: 'PRIVATE DEFINITION BODY',
    creationMode: 'all_at_once',
    tasks: [
      {
        key: 'prepare',
        title: 'Private preparation',
        description: 'PRIVATE TASK BODY',
        teamId: seed.teamId,
        assigneeId: seed.actorId,
      },
    ],
  });
  const published = await createPublishedProcessDefinition(schema.db, {
    organizationId: seed.orgId,
    actorId: seed.actorId,
    definition,
  });
  const series = await createRecurrenceSeries(schema.db, {
    organizationId: seed.orgId,
    actorId: seed.actorId,
    series: RecurrenceSeriesCreate.parse({
      processDefinitionId: published.definitionId,
      name: 'PRIVATE DINNER SCHEDULE',
      effectiveFrom: '2026-10-15',
      trigger: { kind: 'manual' },
    }),
  });
  const run = await materializeSeriesOccurrence(schema.db, {
    organizationId: seed.orgId,
    actorId: seed.actorId,
    seriesId: series.id,
    scheduledFor: '2026-10-15',
  });
  const sourceTask = await seedTask(schema.db, schema, seed.statusId, {
    organizationId: seed.orgId,
    teamId: seed.teamId,
    projectId: seed.projectId,
    title: 'Secret source task',
    description: 'PRIVATE SOURCE BODY',
    visibility: 'private',
    createdBy: seed.actorId,
    state: 'backlog',
  });
  return {
    ...seed,
    definition,
    published,
    series,
    run,
    sourceTask,
    program,
    otherContext,
    ownerProcesses: appWithActor(processes, seed.orgId, ['manage'], seed.actorId),
    otherProcesses: appWithActor(processes, seed.orgId, ['contribute'], seed.sarahId),
    ownerRecurrence: appWithActor(recurrence, seed.orgId, ['manage'], seed.actorId),
    otherRecurrence: appWithActor(recurrence, seed.orgId, ['contribute'], seed.sarahId),
  };
}
