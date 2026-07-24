/**
 * `@docket/ui/hooks` — barrel for the app-shell React hooks.
 *
 * @remarks
 * Re-exports the vocabulary provider/resolver, the ListView keyboard hook, and the
 * already-authenticated redirect guard so consumers can import them from a single subpath:
 * `import { VocabularyProvider, useListKeyboard } from '@docket/ui/hooks'`.
 */
export {
  useListKeyboard,
  type UseListKeyboardOptions,
  type UseListKeyboardResult,
} from './useListKeyboard';
export { useMediaQuery } from './useMediaQuery';
export { useRedirectIfAuthenticated } from './useRedirectIfAuthenticated';
export {
  type UseVocabularyOptions,
  useVocabulary,
  type VocabularyContextValue,
  VocabularyProvider,
  type VocabularyProviderProps,
} from './useVocabulary';
