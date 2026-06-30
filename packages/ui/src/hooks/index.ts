/**
 * `@docket/ui/hooks` — barrel for the app-shell React hooks.
 *
 * @remarks
 * Re-exports the vocabulary provider/resolver and the ListView keyboard hook so consumers
 * can import them from a single subpath:
 * `import { VocabularyProvider, useListKeyboard } from '@docket/ui/hooks'`.
 */
export {
  useListKeyboard,
  type UseListKeyboardOptions,
  type UseListKeyboardResult,
} from './useListKeyboard';
export { useMediaQuery } from './useMediaQuery';
export {
  type UseVocabularyOptions,
  useVocabulary,
  type VocabularyContextValue,
  VocabularyProvider,
  type VocabularyProviderProps,
} from './useVocabulary';
