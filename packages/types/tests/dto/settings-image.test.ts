/**
 * Unit tests for the Settings image data-URL size check.
 *
 * @remarks
 * Base64 padding (`=`/`==`) changes how many trailing bytes the decoded payload actually has, so
 * the 1 MB check has to read the padding correctly in all three cases (none, one, two) or it will
 * over- or under-count a boundary image by a byte or two.
 */
import { describe, expect, it } from 'vitest';

import { SettingsImageData } from '../../src/settings-image';

describe('SettingsImageData', () => {
  it('accepts a base64 payload with no padding', () => {
    expect(SettingsImageData.safeParse('data:image/png;base64,AAAA').success).toBe(true);
  });

  it('accepts a base64 payload with single-character padding', () => {
    expect(SettingsImageData.safeParse('data:image/png;base64,aGVsbG8=').success).toBe(true);
  });

  it('accepts a base64 payload with double-character padding', () => {
    expect(SettingsImageData.safeParse('data:image/png;base64,YQ==').success).toBe(true);
  });

  it('refuses a payload whose decoded size exceeds 1 MB', () => {
    // 1,398,104 base64 characters decode to 1,048,578 bytes — 2 bytes over the 1 MiB cap — while
    // staying well under the outer 1.5 MB encoded-length guard, so this exercises the byte-size
    // check itself rather than the length cap.
    const oversized = 'A'.repeat(1_398_104);
    expect(SettingsImageData.safeParse(`data:image/png;base64,${oversized}`).success).toBe(false);
  });
});
