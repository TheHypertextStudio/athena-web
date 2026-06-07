/**
 * The open-documents store — barrel.
 *
 * @remarks
 * Re-exports the multi-document store: the {@link OpenDocumentsProvider} (mounted in the
 * `(app)` shell to track open tabs, resolve titles, and persist them per user) and the
 * {@link useOpenDocuments} hook the shell's tab bar reads. The shell renders the tab bar from
 * `@docket/ui/components`; this module owns the state behind it.
 */
export {
  OpenDocumentsProvider,
  type OpenDocumentsProviderProps,
  type OpenDocumentsValue,
  useOpenDocuments,
} from './open-documents';
export { hrefForTab, type TabRef, tabKey } from './types';
export { tabRefFromPath } from './route-tabs';
