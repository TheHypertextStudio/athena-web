import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { persistBlueprintProjection } from '../../src/work-template-blueprint-projection';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';

function boundedGraph(): unknown {
  const steps = Array.from({ length: 499 }, (_, index) => ({
    key: `step_${index}`,
    kind: 'task',
    parentStepKey: null,
    sort: index,
    optional: { enabled: false, selectedByDefault: true },
    template: null,
    teamRule: 'creation_team',
    actorRule: 'unassigned',
    cycleRule: 'none',
    fields: { title: `Task ${index}` },
    dates: {},
  }));
  const dependencies = steps.flatMap((_, index) =>
    [1, 2, 3, 4].flatMap((offset) =>
      index + offset < 499
        ? [{ blockerStepKey: `step_${index}`, blockedStepKey: `step_${index + offset}` }]
        : [],
    ),
  );
  for (let index = 0; dependencies.length < 2000; index++)
    dependencies.push({ blockerStepKey: `step_${index}`, blockedStepKey: `step_${index + 5}` });
  return { steps, dependencies };
}

/** Publish the full500-node/2000-edge valid DAG within one bounded PostgreSQL statement budget. */
export async function exerciseBlueprintNearCap(
  database: Database,
  organizationId: string,
): Promise<void> {
  const [publication] = await migrationRows<{
    id: string;
    work_type_id: string;
    definition: unknown;
  }>(
    database,
    sql`select v.id,v.work_type_id,v.definition from work_type_version v join template t on t.id=v.work_type_id where t.organization_id=${organizationId} and t.target_type='project' and not t.is_base limit 1`,
  );
  if (!publication) throw new Error('Required scale fixture publication is missing.');
  const definition = WorkTemplateDefinition.parse({
    ...WorkTemplateDefinition.parse(publication.definition),
    blueprint: boundedGraph(),
  });
  const versionId = genId();
  await database.execute(sql`set statement_timeout='5s'`);
  await database.execute(sql`set temp_file_limit='64MB'`);
  try {
    await database.transaction(async (tx) => {
      await tx.execute(
        sql`insert into work_type_version(id,organization_id,work_type_id,number,definition) values(${versionId},${organizationId},${publication.work_type_id},2,${JSON.stringify(definition)}::jsonb)`,
      );
      const ids = await persistBlueprintProjection(tx, {
        organizationId,
        versionId,
        blueprint: definition.blueprint,
      });
      if (Object.keys(ids).length !== 499)
        throw new Error('Near-cap projection lost authored steps.');
    });
  } finally {
    await database.execute(sql`set statement_timeout=0`);
    await database.execute(sql`set temp_file_limit=-1`);
  }
  if (
    (
      await migrationRows(
        database,
        sql`select id from blueprint_step where version_id=${versionId}`,
      )
    ).length !== 499
  )
    throw new Error('Near-cap publication failed to commit atomically.');
}
