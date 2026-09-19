/**
 * Give an `EntityMetadataRow` a layout to measure in jsdom, which has none.
 *
 * @remarks
 * The row demotes items whose measured width does not fit, and jsdom measures everything as zero,
 * so an unmocked row shows only its priority-zero items. This makes each metadata item 80px wide
 * and the row wide enough for all of them, so a test sees the row as it renders on a wide pane.
 */
import { vi } from 'vitest';

/** Mock the box measurements the metadata row reads. Restore with `vi.restoreAllMocks()`. */
export function mockWideMetadataRow(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const isItem = this.hasAttribute('data-entity-metadata-priority');
    const width = isItem ? 80 : 4000;
    return {
      x: 0,
      y: 0,
      top: 0,
      right: width,
      bottom: 28,
      left: 0,
      width,
      height: 28,
      toJSON: () => ({}),
    };
  });
}
