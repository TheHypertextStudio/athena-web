import { z } from 'zod';
import { TaskCreate } from '@docket/work/task-model';
import { InitiativeCreate } from '@docket/work/initiative-contract';
import { ProgramCreate } from '@docket/work/program-contract';
import { BlueprintPreviewOptions } from '@docket/work/work-template-blueprint';
import { ProjectCreate } from './project';

const fields = {
  options: BlueprintPreviewOptions.default({ optionalChoices: [] }),
  summaryOffset: z.number().int().min(0).max(10000).default(0),
};
/** Kind-correlated ordinary root request, with read-only choices outside the mutation body. */
export const WorkTemplateBlueprintPreviewRequest = z.discriminatedUnion('kind', [
  z.strictObject({ ...fields, kind: z.literal('task'), body: TaskCreate }),
  z.strictObject({ ...fields, kind: z.literal('project'), body: ProjectCreate }),
  z.strictObject({ ...fields, kind: z.literal('initiative'), body: InitiativeCreate }),
  z.strictObject({ ...fields, kind: z.literal('program'), body: ProgramCreate }),
]);
/** Read-only creation request value. */
export type WorkTemplateBlueprintPreviewRequest = z.infer<
  typeof WorkTemplateBlueprintPreviewRequest
>;
