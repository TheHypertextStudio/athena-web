/**
 * `@docket/ui/vocabulary` — the built-in vocabulary presets.
 *
 * @remarks
 * Each preset is a full map of every vocabulary key (initiative, program, project, task,
 * cycle, team) to its singular/plural `VocabularyTerm`. An org selects one of these
 * presets via its `VocabularySkin` and may override individual keys; `useVocabulary`
 * resolves a label as `org.overrides[key]` then `preset[key]` then `presetStartup[key]`.
 * Components must never hardcode entity labels — always resolve through these presets.
 *
 * The tables themselves live in `@docket/types` alongside `VocabularySkin`, which already
 * declares itself their canonical source. They moved there because the server needs them too:
 * the Notion mirror titles each designed database with the org's own term for the entity, and
 * neither `@docket/api` nor `@docket/integrations` may depend on a React package. This module
 * re-exports them so every existing `@docket/ui/vocabulary` import keeps working unchanged.
 */
export {
  VOCABULARY_PRESETS,
  presetAgency,
  presetNonprofit,
  presetStartup,
  resolveVocabularyTerm,
  type VocabularyKey,
  type VocabularyPresetMap,
} from '@docket/types';
