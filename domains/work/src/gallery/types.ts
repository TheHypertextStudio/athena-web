import { z } from 'zod';
import { WorkTypeId, WorkTypeVersionId } from '../ids';
import { WorkTemplateDefinition } from '../contracts/work-template';
import { ProgramDefaultSchedules } from '../contracts/work-schedule-defaults';
/** Explicit onboarding forks; an empty array leaves an entry gallery-only. */
export const GalleryFork = z.enum(['startup', 'nonprofit', 'agency', 'personal']);
/** Onboarding fork value. */
export type GalleryFork = z.infer<typeof GalleryFork>;
/** Approved gallery browse categories. */
export const GalleryCategory = z.enum([
  'intake',
  'engineering-product',
  'marketing-content',
  'sales-clients',
  'operations-finance',
  'people',
  'nonprofit',
  'events',
  'research-writing',
  'personal',
]);
/** Gallery browse category value. */
export type GalleryCategory = z.infer<typeof GalleryCategory>;
/** One checked catalog source; Program defaults remain composed beside the current canonical layer2 definition. */
export const GalleryEntry = z
  .strictObject({
    id: WorkTypeId,
    versionId: WorkTypeVersionId,
    release: z.literal(1),
    slug: z.string().regex(/^[a-z][a-z0-9-]*$/),
    category: GalleryCategory,
    forks: z.array(GalleryFork).refine((values) => new Set(values).size === values.length),
    use: z.string().min(1).max(300),
    definition: WorkTemplateDefinition,
    defaultSchedules: ProgramDefaultSchedules,
    labelSuggestions: z.array(z.string().min(1)).max(10),
    offeringSuggestions: z.array(z.string().min(1)).max(10),
  })
  .refine(
    (entry) =>
      entry.definition.payload.targetType === 'program' || entry.defaultSchedules.length === 0,
    'Only Programs carry default schedules.',
  );
/** Checked immutable catalog source entry value. */
export type GalleryEntry = z.infer<typeof GalleryEntry>;
