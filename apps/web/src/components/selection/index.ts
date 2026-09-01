/**
 * `@/components/selection` — the multi-select contract.
 *
 * @remarks
 * Every view that renders more than one object wraps its rows in {@link SelectionProvider} and
 * binds each row with {@link useSelectableRow}. Rows then support modifier-click, keyboard range
 * extension, select-all, and checkboxes identically everywhere, because the rules live in one pure
 * module rather than in each list.
 */
export {
  SelectAllCheckbox,
  SelectionCheckbox,
  type SelectionCheckboxProps,
} from './selection-checkbox';
export {
  SelectionProvider,
  type SelectionContainerProps,
  type SelectionContextValue,
  type SelectionProviderProps,
  type SelectableRowBinding,
  type SelectableRowProps,
  useOptionalSelection,
  useSelectableRow,
  useSelection,
  useSelectionActions,
  useSelectionContainerRef,
} from './selection-context';
export {
  type EntityTableSelectionBinding,
  entityTableSelectionIntent,
  useEntityTableSelection,
} from './entity-table-selection';
export {
  EMPTY_SELECTION,
  applySelectionIntent,
  intentFromClick,
  pruneSelection,
  resolveSelectionKey,
  type SelectionIntent,
  type SelectionKeyEvent,
  type SelectionKeyResolution,
  type SelectionPointerModifiers,
  type SelectionState,
} from './selection-model';
export {
  SELECTION_SURFACE_ATTRIBUTE,
  SELECTION_SURFACE_SELECTOR,
  type SelectionSurfaceSnapshot,
  readSelectionSurface,
  readSelectionSurfaceFor,
  registerSelectionSurface,
} from './selection-registry';
