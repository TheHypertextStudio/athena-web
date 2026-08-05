'use client';

/**
 * Where the caret is, in a plain textarea.
 *
 * @remarks
 * A textarea exposes a character offset and nothing about geometry, so the only way to anchor a
 * menu to the caret is to render the same text into a hidden element that wraps identically and
 * measure a marker placed at the offset.
 *
 * The arithmetic is separated from the DOM work on purpose. jsdom reports every rect as zero, so a
 * test that went through the mirror would assert nothing; splitting the calculation out means the
 * part that can be wrong — scroll offsets, clamping to the visible box — is tested with injected
 * rectangles, and the part that cannot be tested is a few lines of copying styles.
 */

/** A rectangle, in the shape both `DOMRect` and a test fixture can provide. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** What the caret's position depends on. */
export interface CaretRectInput {
  /** The marker's box inside the mirror, relative to the mirror's own origin. */
  readonly marker: Rect;
  /** The textarea's box in viewport coordinates. */
  readonly element: Rect;
  /** How far the textarea is scrolled. */
  readonly scrollTop: number;
  readonly scrollLeft: number;
}

/**
 * Place the caret in viewport coordinates.
 *
 * @remarks
 * The result is clamped to the textarea's own box. Without that, a caret scrolled out of view would
 * anchor the menu somewhere off the field — floating beside an unrelated part of the page, or off
 * screen entirely. Clamping keeps it attached to the edge the caret went past, which is where a
 * reader's attention already is.
 *
 * @param input - The measured marker, the field, and its scroll offsets.
 * @returns The caret rectangle, in viewport coordinates.
 *
 * @example
 * ```typescript
 * caretRectFrom({
 *   marker: { left: 40, top: 18, width: 1, height: 16 },
 *   element: { left: 100, top: 200, width: 300, height: 80 },
 *   scrollTop: 0,
 *   scrollLeft: 0,
 * });
 * // { left: 140, top: 218, width: 1, height: 16 }
 * ```
 */
export function caretRectFrom(input: CaretRectInput): Rect {
  const { marker, element, scrollTop, scrollLeft } = input;

  const rawLeft = element.left + marker.left - scrollLeft;
  const rawTop = element.top + marker.top - scrollTop;

  const maxLeft = element.left + element.width;
  const maxTop = element.top + element.height;

  return {
    left: Math.min(Math.max(rawLeft, element.left), maxLeft),
    top: Math.min(Math.max(rawTop, element.top), maxTop),
    width: marker.width,
    height: marker.height,
  };
}

/** The style properties a mirror must copy for its text to wrap exactly like the original. */
const MIRRORED_PROPERTIES = [
  'boxSizing',
  'width',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'textIndent',
  'textRendering',
  'whiteSpace',
  'wordBreak',
  'overflowWrap',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
] as const;

/**
 * Measure the caret in a real textarea.
 *
 * @remarks
 * Builds a throwaway mirror, measures, and removes it in the same synchronous block, so nothing
 * about it can be seen or interacted with. The mirror is visually hidden rather than
 * `display: none`, because a hidden element has no layout and therefore no rectangle to measure.
 *
 * @param element - The textarea to measure inside.
 * @param offset - The caret's character offset.
 * @returns The caret rectangle in viewport coordinates.
 */
export function measureCaretRect(element: HTMLTextAreaElement, offset: number): Rect {
  const mirror = document.createElement('div');
  const computed = window.getComputedStyle(element);
  for (const property of MIRRORED_PROPERTIES) {
    mirror.style.setProperty(
      property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      computed.getPropertyValue(property.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`)),
    );
  }
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '0';
  // A textarea always wraps and always scrolls its own content; the mirror must do the same or the
  // measured line will be the wrong one.
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';

  mirror.textContent = element.value.slice(0, offset);
  const marker = document.createElement('span');
  // A zero-width space, so the marker occupies a real line box without adding visible width.
  marker.textContent = '​';
  mirror.append(marker);
  document.body.append(mirror);

  const mirrorBox = mirror.getBoundingClientRect();
  const markerBox = marker.getBoundingClientRect();
  const rect = caretRectFrom({
    marker: {
      left: markerBox.left - mirrorBox.left,
      top: markerBox.top - mirrorBox.top,
      width: Math.max(markerBox.width, 1),
      height: markerBox.height,
    },
    element: element.getBoundingClientRect(),
    scrollTop: element.scrollTop,
    scrollLeft: element.scrollLeft,
  });
  mirror.remove();
  return rect;
}
