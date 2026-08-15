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
 * The tables live in `@docket/work/vocabulary`, alongside the organization skin they resolve.
 * They are plain data because browser, API, integrations, and future desktop clients all need
 * the same labels without depending on a React package. This module keeps the established
 * `@docket/ui/vocabulary` surface available for UI consumers.
 */
export {
  VOCABULARY_PRESETS,
  presetAgency,
  presetNonprofit,
  presetStartup,
  resolveVocabularyTerm,
  type VocabularyKey,
  type VocabularyPresetMap,
} from '@docket/work/vocabulary';
