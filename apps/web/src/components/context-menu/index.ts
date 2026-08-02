/**
 * `@/components/context-menu` — the global right-click contract.
 *
 * @remarks
 * Mounted once by `InteractionProvider`. A surface never renders a context menu; it marks its
 * elements with `objectTargetProps` and the menu appears, built from whatever the action registry
 * says applies. {@link useObjectContextMenu} exists only so an overflow ("…") button can raise the
 * *same* menu rather than growing a second, divergent one.
 */
export {
  ObjectContextMenuProvider,
  type ObjectContextMenuControls,
  type ObjectContextMenuProviderProps,
  useObjectContextMenu,
} from './object-context-menu';
