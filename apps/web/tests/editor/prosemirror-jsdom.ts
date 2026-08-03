/**
 * The three layout APIs ProseMirror needs and jsdom does not implement.
 *
 * @remarks
 * ProseMirror maps between screen coordinates and document positions on every mouse event and
 * on every selection change. jsdom has no layout, so `document.elementFromPoint`,
 * `document.caretRangeFromPoint`, and `Range.prototype.getClientRects` are simply absent — and
 * ProseMirror's calls into them throw *asynchronously*, outside any test's call stack. Vitest
 * counts those as unhandled errors and exits non-zero even when every assertion passed, so a
 * suite that exercises a real editor has to supply them.
 *
 * They return "nothing here", which is the honest answer in an environment with no layout:
 * ProseMirror falls back to its DOM-walking path, which is what these tests exercise anyway.
 * Nothing here fakes a *result* — only the absence of one.
 */

/** Install the shims on the current jsdom document. Call once per test file, before rendering. */
export function installProseMirrorLayoutShims(): void {
  // Indexed rather than dotted: `caretRangeFromPoint` is deprecated in the DOM lib, but
  // ProseMirror still probes for it, so the shim has to exist without the call site inheriting
  // a deprecation error.
  const doc = globalThis.document as unknown as Record<string, unknown>;
  doc['elementFromPoint'] = () => null;
  doc['caretRangeFromPoint'] = () => null;
  doc['caretPositionFromPoint'] = () => null;
  const range = globalThis.Range.prototype as Range & {
    getClientRects: () => DOMRectList;
    getBoundingClientRect: () => DOMRect;
  };
  const emptyRects = Object.assign([] as unknown as DOMRectList, {
    item: () => null,
    length: 0,
  }) as DOMRectList;
  range.getClientRects = () => emptyRects;
  range.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}
