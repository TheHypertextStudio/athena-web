/**
 * The Docket command palette — the unified Cmd/Ctrl+K surface.
 *
 * @remarks
 * Barrel for the global command palette: the {@link CommandPaletteProvider} (mounted once in
 * the `(app)` shell to own open state + the keyboard shortcut + the overlay), the
 * {@link useCommandPalette} hook the rail/triggers drive it through, and the visible
 * {@link CommandPaletteTrigger}. The palette itself fuses cross-org entity search,
 * navigation, actions, and org-switching, with a Hub-global vs org-local scope toggle.
 */
export {
  CommandPaletteProvider,
  type CommandPaletteValue,
  useCommandPalette,
} from './command-palette-provider';
export { CommandPaletteTrigger, type CommandPaletteTriggerProps } from './command-palette-trigger';
export { type CommandPaletteProps } from './command-palette';
export type { PaletteItem, PaletteScope, PaletteSection } from './types';
