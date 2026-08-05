/**
 * The copy of the mark inlined into the offline fallback page.
 *
 * @remarks
 * The offline page cannot fetch `/icon.svg` — it is what gets shown when fetching anything is what
 * failed — so the mark has to be inline. That made it a hand-maintained duplicate of the favicon
 * which nothing checked, and it drifted. These functions are what
 * {@link file://./render-web.ts} writes and what {@link file://../tests/offline-page.test.ts}
 * checks, so the page cannot fall behind the mark without failing the suite.
 *
 * Kept apart from the renderer because that module runs its work on import; a test that only
 * wants the expected markup must not trigger a write.
 */
import { OFFLINE_MARK_SIZE } from './paths';
import { themedMarkSvg } from './svg';

/** The container in the offline page whose entire contents are the mark. */
const DISC_OPEN = '<div class="disc" aria-hidden="true">';

/** Indentation the offline page's markup sits at inside that container. */
const DISC_INDENT = ' '.repeat(8);

/**
 * The mark as it appears inside the offline page's disc, indentation included.
 *
 * @returns The indented `<svg>` element, with no trailing newline.
 */
export function offlineMarkMarkup(): string {
  return themedMarkSvg(OFFLINE_MARK_SIZE)
    .trimEnd()
    .split('\n')
    .map((line) => DISC_INDENT + line)
    .join('\n');
}

/**
 * Replace the mark inside the offline page, leaving every other byte of it alone.
 *
 * @param html - The current page source.
 * @returns The page with a freshly generated mark.
 * @throws {Error} If the disc container is missing, duplicated, or unclosed — rather than writing
 * a page whose mark landed somewhere unintended.
 */
export function withRegeneratedMark(html: string): string {
  const open = html.indexOf(DISC_OPEN);
  if (open === -1 || html.includes(DISC_OPEN, open + 1)) {
    throw new Error(`Expected exactly one \`${DISC_OPEN}\` in the offline page.`);
  }
  const start = open + DISC_OPEN.length;
  const end = html.indexOf('</div>', start);
  if (end === -1) {
    throw new Error('The offline page’s disc container is never closed.');
  }
  return `${html.slice(0, start)}\n${offlineMarkMarkup()}\n${DISC_INDENT.slice(2)}${html.slice(end)}`;
}
