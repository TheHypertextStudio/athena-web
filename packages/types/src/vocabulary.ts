/**
 * `@docket/types` — the canonical Zod source for vocabulary skins.
 *
 * @remarks
 * Single source of truth; `@docket/db` mirrors this as a `$type` and `@docket/ui`
 * consumes it via `useVocabulary`.
 */
import { z } from 'zod';

/** The selectable vocabulary preset bundles. */
export const VocabularyPreset = z.enum(['startup', 'nonprofit', 'agency']);
/** Vocabulary preset value. */
export type VocabularyPreset = z.infer<typeof VocabularyPreset>;

/** A singular/plural label pair for one vocabulary key. */
export const VocabularyTerm = z.object({
  /** Singular form (e.g. "Project"). */
  singular: z.string(),
  /** Plural form (e.g. "Projects"). */
  plural: z.string(),
});
/** Vocabulary term value. */
export type VocabularyTerm = z.infer<typeof VocabularyTerm>;

/** An org's vocabulary skin: a preset plus optional per-key overrides. */
export const VocabularySkin = z.object({
  /** The base preset. */
  preset: VocabularyPreset,
  /** Per-key overrides keyed by vocabulary key (program/project/task/…). */
  overrides: z.record(z.string(), VocabularyTerm).optional(),
});
/** Vocabulary skin value. */
export type VocabularySkin = z.infer<typeof VocabularySkin>;
