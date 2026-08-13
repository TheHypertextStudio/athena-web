/**
 * `components/clipboard` — the app's copy handling.
 *
 * @remarks
 * Mount {@link ClipboardProvider} once, next to the object context menu. Any element already
 * wearing `objectTargetProps` then becomes copyable with ⌘C, and any selection inside rendered
 * Markdown copies as Markdown. Surfaces contribute content; this contributes the gesture.
 */
export { ClipboardProvider, type ClipboardProviderProps } from './clipboard-provider';
