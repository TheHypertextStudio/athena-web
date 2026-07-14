/**
 * `@docket/types` — presentation metadata shared by strategic work entities.
 *
 * @remarks
 * Display choices live outside Initiative and Project planning records. The curated keys keep
 * persisted data independent from a specific icon package or raw color value.
 */
import { z } from 'zod';

/** Work entities that may carry separately stored display metadata. */
export const EntityDisplaySubjectType = z.enum(['initiative', 'project']);
/** Supported display-metadata subject type. */
export type EntityDisplaySubjectType = z.infer<typeof EntityDisplaySubjectType>;

/** Stable icon keys mapped to the current Material icon set by each client. */
export const EntityDisplayIconKey = z.enum([
  'target',
  'flag',
  'layers',
  'folder',
  'workflow',
  'globe',
  'users',
  'sparkles',
]);
/** Supported entity-display icon key. */
export type EntityDisplayIconKey = z.infer<typeof EntityDisplayIconKey>;

/** Semantic color keys resolved through the Docket design tokens. */
export const EntityDisplayColorKey = z.enum(['neutral', 'primary', 'success', 'warning', 'danger']);
/** Supported entity-display color key. */
export type EntityDisplayColorKey = z.infer<typeof EntityDisplayColorKey>;

/** Complete display metadata composed for a supported work entity. */
export const EntityDisplayOut = z.object({
  subjectType: EntityDisplaySubjectType,
  subjectId: z.string().min(1),
  iconKey: EntityDisplayIconKey,
  colorKey: EntityDisplayColorKey,
  customized: z.boolean(),
});
/** Composed entity-display metadata. */
export type EntityDisplayOut = z.infer<typeof EntityDisplayOut>;

/** Complete replacement body for an entity's optional display customization. */
export const EntityDisplayUpdate = z.object({
  iconKey: EntityDisplayIconKey,
  colorKey: EntityDisplayColorKey,
});
/** Validated entity-display update. */
export type EntityDisplayUpdate = z.infer<typeof EntityDisplayUpdate>;

/** Resolve the uncoupled display defaults for a supported work entity. */
export function defaultEntityDisplay(
  subjectType: EntityDisplaySubjectType,
  subjectId: string,
): EntityDisplayOut {
  return {
    subjectType,
    subjectId,
    iconKey: subjectType === 'initiative' ? 'target' : 'folder',
    colorKey: 'neutral',
    customized: false,
  };
}
