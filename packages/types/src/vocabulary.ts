/**
 * `@docket/types` — the canonical Zod source for vocabulary skins.
 *
 * @remarks
 * Single source of truth; `@docket/db` mirrors this as a `$type` and `@docket/ui`
 * consumes it via `useVocabulary`.
 */
import { z } from 'zod';

/** The selectable vocabulary preset bundles. */
export const VocabularyPreset = z
  .enum(['startup', 'nonprofit', 'agency'])
  .describe(
    'A vocabulary skin that relabels Docket\'s work hierarchy to a domain\'s native terms (the underlying data model is identical; only display labels change). `startup`: the default product language — Initiatives, Programs, Projects, Tasks. `nonprofit`: reframes work as mission/program delivery (e.g. Initiatives → "Campaigns"/programs of work). `agency`: reframes work as client delivery (e.g. Projects → client engagements). Consumers resolve labels via `useVocabulary`.',
  );
/** Vocabulary preset value. */
export type VocabularyPreset = z.infer<typeof VocabularyPreset>;

/** A singular/plural label pair for one vocabulary key. */
export const VocabularyTerm = z
  .object({
    singular: z.string().describe('Singular display form (e.g. "Project").'),
    plural: z.string().describe('Plural display form (e.g. "Projects").'),
  })
  .describe('The singular/plural label pair a vocabulary key resolves to.');
/** Vocabulary term value. */
export type VocabularyTerm = z.infer<typeof VocabularyTerm>;

/** An org's vocabulary skin: a preset plus optional per-key overrides. */
export const VocabularySkin = z
  .object({
    preset: VocabularyPreset.describe('The base preset the org starts from.'),
    overrides: z
      .record(z.string(), VocabularyTerm)
      .optional()
      .describe(
        "Per-key term overrides keyed by vocabulary key (e.g. `program`, `project`, `task`); each overrides the preset's default label pair for that key.",
      ),
  })
  .describe(
    "An org's chosen vocabulary skin: a base preset plus optional per-key label overrides.",
  );
/** Vocabulary skin value. */
export type VocabularySkin = z.infer<typeof VocabularySkin>;
