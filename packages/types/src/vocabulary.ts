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

/** The vocabulary keys every preset must define. */
export type VocabularyKey = 'initiative' | 'program' | 'project' | 'task' | 'cycle' | 'team';

/** A complete preset: every {@link VocabularyKey} mapped to its term pair. */
export type VocabularyPresetMap = Record<VocabularyKey, VocabularyTerm>;

/**
 * Startup vocabulary — the neutral default used by the Hub and as the final fallback.
 *
 * @remarks
 * The preset tables live here rather than in `@docket/ui` because they are plain data the server
 * needs too: the Notion mirror seeds each designed database's default title from the org's own
 * term for the entity, and neither `@docket/api` nor `@docket/integrations` may depend on a React
 * package. `@docket/ui/vocabulary` re-exports these, so `useVocabulary` is unchanged.
 */
export const presetStartup: VocabularyPresetMap = {
  initiative: { singular: 'Initiative', plural: 'Initiatives' },
  program: { singular: 'Program', plural: 'Programs' },
  project: { singular: 'Project', plural: 'Projects' },
  task: { singular: 'Task', plural: 'Tasks' },
  cycle: { singular: 'Cycle', plural: 'Cycles' },
  team: { singular: 'Team', plural: 'Teams' },
};

/**
 * Nonprofit vocabulary — mission-oriented labels for programs and the people they serve.
 *
 * @remarks
 * Deliberately distinct from {@link presetStartup}: `program` is the hero term, work is
 * planned in `Season`s rather than engineering `Cycle`s, and the people doing the work are
 * organised into `Chapter`s rather than product `Team`s. Only `project` and `task` — which
 * read the same across every sector — match the startup defaults.
 */
export const presetNonprofit: VocabularyPresetMap = {
  initiative: { singular: 'Campaign', plural: 'Campaigns' },
  program: { singular: 'Program', plural: 'Programs' },
  project: { singular: 'Project', plural: 'Projects' },
  task: { singular: 'Task', plural: 'Tasks' },
  cycle: { singular: 'Season', plural: 'Seasons' },
  team: { singular: 'Chapter', plural: 'Chapters' },
};

/** Agency vocabulary — client-services labels (retainers, engagements, etc.). */
export const presetAgency: VocabularyPresetMap = {
  initiative: { singular: 'Engagement', plural: 'Engagements' },
  program: { singular: 'Retainer', plural: 'Retainers' },
  project: { singular: 'Project', plural: 'Projects' },
  task: { singular: 'Task', plural: 'Tasks' },
  cycle: { singular: 'Sprint', plural: 'Sprints' },
  team: { singular: 'Pod', plural: 'Pods' },
};

/** Lookup table from a {@link VocabularyPreset} name to its full {@link VocabularyPresetMap}. */
export const VOCABULARY_PRESETS: Record<VocabularyPreset, VocabularyPresetMap> = {
  startup: presetStartup,
  nonprofit: presetNonprofit,
  agency: presetAgency,
};

/**
 * Resolve one vocabulary key against an org's skin, without React.
 *
 * @remarks
 * The server-side equivalent of `useVocabulary`, resolving in the same order:
 * `skin.overrides[key]` → `VOCABULARY_PRESETS[skin.preset][key]` → {@link presetStartup}`[key]`.
 *
 * @param skin - The org's vocabulary skin, or null/undefined for the neutral default.
 * @param key - The vocabulary key to resolve.
 * @returns the singular/plural term pair to display.
 */
export function resolveVocabularyTerm(
  skin: VocabularySkin | null | undefined,
  key: VocabularyKey,
): VocabularyTerm {
  if (!skin) return presetStartup[key];
  return skin.overrides?.[key] ?? VOCABULARY_PRESETS[skin.preset][key];
}
