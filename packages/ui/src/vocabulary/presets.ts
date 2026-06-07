/**
 * `@docket/ui/vocabulary` — the built-in vocabulary presets.
 *
 * @remarks
 * Each preset is a full map of every vocabulary key (initiative, program, project, task,
 * cycle, team) to its singular/plural {@link VocabularyTerm}. An org selects one of these
 * presets via its {@link VocabularySkin} and may override individual keys; `useVocabulary`
 * resolves a label as `org.overrides[key]` then `preset[key]` then `presetStartup[key]`.
 * Components must never hardcode entity labels — always resolve through these presets.
 */
import type { VocabularyTerm } from '@docket/types';

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
export const VOCABULARY_PRESETS: Record<'startup' | 'nonprofit' | 'agency', VocabularyPresetMap> = {
  startup: presetStartup,
  nonprofit: presetNonprofit,
  agency: presetAgency,
};
