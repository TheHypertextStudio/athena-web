/** Published task identities carried by existing immutable process specifications. */
import type { Database } from '@docket/db';
import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import { ProcessDefinitionCreate, ProcessTaskSpec } from '../../contracts/recurrence';
import { prepareWorkTemplateCreation } from '../work-template-creation';

/** Fully normalized specifications ready for immutable process persistence. */
export type PreparedProcessDefinition = Omit<ProcessDefinitionCreate, 'tasks'> & {
  tasks: ProcessTaskSpec[];
};

/** Resolve selected task versions before opening the process authoring transaction. */
export async function prepareProcessTemplates(
  database: Database,
  orgId: string,
  input: unknown,
): Promise<PreparedProcessDefinition> {
  const definition = ProcessDefinitionCreate.parse(input);
  const tasks = await Promise.all(
    definition.tasks.map(async (step) => {
      const prepared = await prepareWorkTemplateCreation(orgId, 'task', step, database);
      const { labels, ...fields } = prepared;
      const ordinaryFields: Readonly<Record<string, unknown>> = fields;
      return ProcessTaskSpec.parse({
        ...Object.fromEntries(
          Object.entries(ordinaryFields).filter(
            ([key, value]) =>
              Object.hasOwn(ProcessTaskSpec.shape, key) &&
              !(key === 'estimateMinutes' && value === null),
          ),
        ),
        labelIds: step.labelIds ?? labels,
        ...processTaskTemplateIdentity(prepared),
      });
    }),
  );
  return { ...definition, tasks };
}

/** Convert nullable normalized references into optional branded creation references. */
export function processTaskTemplateIdentity(row: {
  workTypeId?: string | null | undefined;
  workTypeVersionId?: string | null | undefined;
}): { workTypeId?: WorkTypeId | undefined; workTypeVersionId?: WorkTypeVersionId | undefined } {
  return {
    workTypeId: row.workTypeId ? WorkTypeId.parse(row.workTypeId) : undefined,
    workTypeVersionId: row.workTypeVersionId
      ? WorkTypeVersionId.parse(row.workTypeVersionId)
      : undefined,
  };
}
