/**
 * Command palette components.
 *
 * This module exports all React components for the command palette:
 *
 * - **CommandPaletteProvider** - Context provider (wrap your app)
 * - **CommandPalette** - The main dialog component
 * - **useCommandPalette** - Hook to access palette context
 *
 * ## Quick Start
 *
 * ```tsx
 * // In your layout
 * import {
 *   CommandPaletteProvider,
 *   CommandPalette,
 * } from '@/components/command-palette';
 *
 * export default function Layout({ children }) {
 *   return (
 *     <CommandPaletteProvider>
 *       {children}
 *       <CommandPalette />
 *     </CommandPaletteProvider>
 *   );
 * }
 * ```
 *
 * @packageDocumentation
 */

export { CommandPaletteProvider, useCommandPalette } from './command-palette-provider';
export { CommandPalette } from './command-palette';
export { CommandPaletteItem } from './command-palette-item';
export { CommandPaletteForm } from './command-palette-form';
