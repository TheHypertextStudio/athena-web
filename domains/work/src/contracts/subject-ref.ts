/** Correlated polymorphic subject identities shared by API input contracts. */
import { z } from 'zod';

import { CycleId, InitiativeId, ProgramId, ProjectId, TaskId } from '../ids';

/** A complete Task subject reference. */
export const TaskSubjectRef = z
  .object({ subjectType: z.literal('task'), subjectId: TaskId })
  .strict();
/** A complete Project subject reference. */
export const ProjectSubjectRef = z
  .object({ subjectType: z.literal('project'), subjectId: ProjectId })
  .strict();
/** A complete Program subject reference. */
export const ProgramSubjectRef = z
  .object({ subjectType: z.literal('program'), subjectId: ProgramId })
  .strict();
/** A complete Initiative subject reference. */
export const InitiativeSubjectRef = z
  .object({ subjectType: z.literal('initiative'), subjectId: InitiativeId })
  .strict();
/** A complete Cycle subject reference. */
export const CycleSubjectRef = z
  .object({ subjectType: z.literal('cycle'), subjectId: CycleId })
  .strict();

/** A subject kind and its correlated branded id, which cannot exist partially. */
export const SubjectRef = z.discriminatedUnion('subjectType', [
  TaskSubjectRef,
  ProjectSubjectRef,
  ProgramSubjectRef,
  InitiativeSubjectRef,
  CycleSubjectRef,
]);
/** A validated complete subject reference. */
export type SubjectRef = z.infer<typeof SubjectRef>;
