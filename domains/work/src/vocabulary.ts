/**
 * Work-domain vocabulary skins for the organization work hierarchy.
 *
 * @remarks
 * A vocabulary skin changes reader-facing labels while preserving the underlying
 * Initiative → Program → Project → Task model. It is deliberately plain data so
 * browser, API, integration, and future desktop clients can resolve the same terms.
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

/** An organization's vocabulary skin: a preset plus optional per-key overrides. */
export const VocabularySkin = z
  .object({
    preset: VocabularyPreset.describe('The base preset the organization starts from.'),
    overrides: z
      .record(z.string(), VocabularyTerm)
      .optional()
      .describe(
        "Per-key term overrides keyed by vocabulary key (e.g. `program`, `project`, `task`); each overrides the preset's default label pair for that key.",
      ),
  })
  .describe(
    "An organization's chosen vocabulary skin: a base preset plus optional per-key label overrides.",
  );
/** Vocabulary skin value. */
export type VocabularySkin = z.infer<typeof VocabularySkin>;

/** The compact vocabulary skin persisted for a newly created organization. */
export const defaultVocabularySkin: VocabularySkin = { preset: 'startup' };

/** The vocabulary keys every preset must define. */
export type VocabularyKey = 'initiative' | 'program' | 'project' | 'task' | 'cycle' | 'team';

/** A complete preset: every {@link VocabularyKey} mapped to its term pair. */
export type VocabularyPresetMap = Record<VocabularyKey, VocabularyTerm>;

/** Startup vocabulary — the neutral default used by the Hub and as the final fallback. */
export const presetStartup: VocabularyPresetMap = {
  initiative: { singular: 'Initiative', plural: 'Initiatives' },
  program: { singular: 'Program', plural: 'Programs' },
  project: { singular: 'Project', plural: 'Projects' },
  task: { singular: 'Task', plural: 'Tasks' },
  cycle: { singular: 'Cycle', plural: 'Cycles' },
  team: { singular: 'Team', plural: 'Teams' },
};

/** Nonprofit vocabulary — mission-oriented labels for programs and the people they serve. */
export const presetNonprofit: VocabularyPresetMap = {
  initiative: { singular: 'Campaign', plural: 'Campaigns' },
  program: { singular: 'Program', plural: 'Programs' },
  project: { singular: 'Project', plural: 'Projects' },
  task: { singular: 'Task', plural: 'Tasks' },
  cycle: { singular: 'Season', plural: 'Seasons' },
  team: { singular: 'Chapter', plural: 'Chapters' },
};

/** Agency vocabulary — client-services labels (retainers, engagements, and pods). */
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
 * Resolve one vocabulary key against an organization's skin, without React.
 *
 * @remarks
 * Resolution is deterministic: `skin.overrides[key]` → `VOCABULARY_PRESETS[skin.preset][key]`
 * → {@link presetStartup}`[key]` when there is no organization skin.
 *
 * @param skin - The organization vocabulary skin, or null/undefined for the neutral default.
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
