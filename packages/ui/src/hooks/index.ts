/**
 * `@docket/ui/hooks` — barrel for the app-shell React hooks.
 *
 * @remarks
 * Re-exports the vocabulary provider/resolver, the ListView keyboard hook, the reorder
 * primitive, the derived screen outline, and the already-authenticated redirect guard so consumers can import them from a
 * single subpath: `import { VocabularyProvider, useReorderable } from '@docket/ui/hooks'`.
 */
export {
  computeDropIndex,
  type DropEdge,
  REORDER_DRAG_MIME,
  type ReorderableBinding,
  type ReorderableHandleProps,
  type ReorderableItemProps,
  useReorderable,
  type UseReorderableOptions,
} from './use-reorderable';
export {
  useListKeyboard,
  type UseListKeyboardOptions,
  type UseListKeyboardResult,
} from './useListKeyboard';
export {
  nearestScrollport,
  type OutlineEntry,
  useActiveOutlineEntry,
  useOutlineEntries,
} from './use-outline';
export { useMediaQuery } from './useMediaQuery';
export { useRedirectIfAuthenticated } from './useRedirectIfAuthenticated';
export {
  type UseVocabularyOptions,
  useVocabulary,
  type VocabularyContextValue,
  VocabularyProvider,
  type VocabularyProviderProps,
} from './useVocabulary';
