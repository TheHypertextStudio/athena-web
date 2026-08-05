import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { offlineMarkMarkup, withRegeneratedMark } from '../src/offline';
import { OFFLINE_PAGE } from '../src/paths';

/**
 * The offline page's inline copy of the mark.
 *
 * @remarks
 * `public/offline.html` is the page shown when a fetch is what failed, so it cannot request
 * `/icon.svg` and has to carry the mark inline. For most of this repository's life that copy was
 * hand-maintained, checked by nothing, and drifted from the favicon. `render-web.ts` writes it now;
 * this is what makes forgetting to re-run it a test failure rather than a stale logo nobody sees
 * until they are offline.
 */

describe('the offline page', () => {
  it('carries the mark the renderer would write today', () => {
    const html = readFileSync(OFFLINE_PAGE, 'utf8');
    expect(
      html,
      'run `pnpm --filter @docket/brand icons:web` to regenerate the offline page',
    ).toContain(offlineMarkMarkup());
  });

  it('is byte-identical after a regeneration, so the writer is idempotent', () => {
    const html = readFileSync(OFFLINE_PAGE, 'utf8');
    expect(withRegeneratedMark(html)).toBe(html);
  });

  it('refuses to write a page whose mark would land somewhere unintended', () => {
    expect(() => withRegeneratedMark('<html><body>no disc here</body></html>')).toThrow(
      /Expected exactly one/,
    );
    expect(() =>
      withRegeneratedMark(
        '<div class="disc" aria-hidden="true"><div class="disc" aria-hidden="true">',
      ),
    ).toThrow(/Expected exactly one/);
    expect(() => withRegeneratedMark('<div class="disc" aria-hidden="true">')).toThrow(
      /never closed/,
    );
  });
});
