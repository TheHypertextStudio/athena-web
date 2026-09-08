/**
 * MCP response contract for the caller's current Time Ledger record and visible task context.
 */
import { z } from 'zod';

import { WorkStatusCategory } from '@docket/work/work-status-contract';

const ActiveWorkReferenceOut = z.object({
  url: z.url(),
  title: z.string().nullable(),
  source: z.enum(['task_attachment', 'task_description', 'task_provenance', 'project_resource']),
});

const ActiveWorkTaskOut = z.object({
  id: z.string(),
  organizationId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  stateType: WorkStatusCategory,
  workspace: z.object({ id: z.string(), name: z.string() }),
  project: z
    .object({ id: z.string(), name: z.string(), summary: z.string().nullable() })
    .nullable(),
  labels: z.array(z.object({ id: z.string(), name: z.string() })),
  references: z.array(ActiveWorkReferenceOut),
});

const ActiveWorkBaseOut = z.object({
  schemaVersion: z.literal('active-work/1'),
  observedAt: z.iso.datetime(),
});

/** The caller's current tracked work, or an explicit idle state when no record is live. */
export const ActiveWorkOut = z.discriminatedUnion('tracking', [
  ActiveWorkBaseOut.extend({
    tracking: z.literal('running'),
    recordId: z.string(),
    task: ActiveWorkTaskOut.nullable(),
  }),
  ActiveWorkBaseOut.extend({
    tracking: z.literal('paused'),
    recordId: z.string(),
    task: ActiveWorkTaskOut.nullable(),
  }),
  ActiveWorkBaseOut.extend({ tracking: z.literal('idle'), recordId: z.null(), task: z.null() }),
]);

/** One valid active-work response. */
export type ActiveWorkOut = z.infer<typeof ActiveWorkOut>;
