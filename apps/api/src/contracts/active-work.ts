/**
 * MCP response contract for the caller's current Time Ledger record and visible task context.
 */
import { z } from 'zod';

const ActiveWorkReferenceOut = z.object({
  url: z.url(),
  title: z.string().nullable(),
  source: z.enum(['task_attachment', 'task_description', 'task_provenance', 'project_resource']),
});

const ActiveWorkTaskOut = z.object({
  id: z.string(),
  title: z.string(),
  workspace: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  labels: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
  references: z.array(ActiveWorkReferenceOut),
});

const ActiveWorkRecordOut = z.object({
  id: z.string(),
  title: z.string(),
  startedAt: z.iso.datetime().nullable(),
});

/** The caller's current tracked work, or an explicit idle state when no record is live. */
export const ActiveWorkOut = z.discriminatedUnion('tracking', [
  z.object({
    tracking: z.literal('running'),
    record: ActiveWorkRecordOut,
    task: ActiveWorkTaskOut.nullable(),
  }),
  z.object({
    tracking: z.literal('paused'),
    record: ActiveWorkRecordOut,
    task: ActiveWorkTaskOut.nullable(),
  }),
  z.object({ tracking: z.literal('idle'), record: z.null(), task: z.null() }),
]);

/** One valid active-work response. */
export type ActiveWorkOut = z.infer<typeof ActiveWorkOut>;
