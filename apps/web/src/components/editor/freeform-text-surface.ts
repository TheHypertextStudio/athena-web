import { cn } from '@docket/ui/lib/utils';

/**
 * A padding preset for `FreeformTextEditor`'s own surface div. `'none'` (the default) leaves the
 * div unpadded and uncapped — the per-block `max-w-[75ch]` on the ProseMirror content is what caps
 * reading width in that case. `'p-3'` also applies the padding itself and adds a matching
 * `max-w-*` cap to the *box*, so a host that tints this div (a composer body, a comment box, an
 * update composer) never draws a container wider than the text it holds. A caller that wants
 * padding on this div picks a preset here instead of hand-adding a `p-*` class through
 * `className`: `className` isn't validated against `max-w-*`, so a caller-supplied padding has no
 * way to keep a box-level cap in sync, which is exactly how this surface ended up drawing
 * full-width tinted boxes around a narrower column of text.
 */
export type FreeformTextEditorPadding = 'none' | 'p-3';

/** The box-level max-width each {@link FreeformTextEditorPadding} preset pairs with its padding. */
const READABLE_MEASURE_BY_PADDING: Record<FreeformTextEditorPadding, string> = {
  // No box-level cap: the per-block `max-w-[75ch]` on the ProseMirror content already bounds the
  // text, and this div itself carries no host-painted background to draw as an oversized box.
  none: 'max-w-none',
  // 1.5rem = p-3's 0.75rem on each side, added on top of the 75ch text budget rather than eaten
  // out of it — same convention as entity-document.tsx's outer box does for its own p-4.
  'p-3': 'max-w-[calc(75ch+1.5rem)]',
};

/** `FreeformTextEditor`'s `data-editor-surface` div classes, given its padding preset and edit state. */
export function editorSurfaceClassName(
  padding: FreeformTextEditorPadding,
  isEditingEnabled: boolean,
  disabled: boolean,
  className: string | undefined,
): string {
  return cn(
    'relative flex min-h-0 flex-1 flex-col [&_.ProseMirror]:min-h-10 [&_.ProseMirror]:flex-1 [&_.ProseMirror]:outline-none [&_.ProseMirror_.is-editor-empty:first-child::before]:hidden [&_.tableWrapper[data-table-controls-visible]]:mt-16 sm:[&_.tableWrapper[data-table-controls-visible]]:mt-14',
    READABLE_MEASURE_BY_PADDING[padding],
    padding === 'p-3' ? 'p-3' : '',
    isEditingEnabled ? 'cursor-text' : '',
    disabled ? 'cursor-default opacity-60' : '',
    className,
  );
}
