/**
 * The mark as the API serves it: a base64 copy of the committed icons, and the `.ico` container.
 *
 * @remarks
 * The copy can go stale, so it is compared byte for byte against the files it encodes, with no
 * rasterizer on either side. And `ico.ts` is a hand-written container of offsets into one flat
 * file, where an off-by-one produces something that parses and renders nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MARK_192_PNG_BASE64,
  MARK_512_PNG_BASE64,
  MARK_ICO_BASE64,
} from '../src/embedded-icons.generated';
import { icoFromPngs } from '../src/ico';
import { PWA_ICONS_DIR, WEB_FAVICON } from '../src/paths';

/** The bytes a generated payload decodes to. */
function decoded(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

/** The eight bytes every PNG opens with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const REGENERATE = 'run `pnpm --filter @docket/brand icons:embedded` to regenerate';

it.each([
  ['icon-192.png', MARK_192_PNG_BASE64, join(PWA_ICONS_DIR, 'icon-192.png')],
  ['icon-512.png', MARK_512_PNG_BASE64, join(PWA_ICONS_DIR, 'icon-512.png')],
  ['favicon.ico', MARK_ICO_BASE64, WEB_FAVICON],
])('embeds the committed %s byte for byte', (_name, payload, file) => {
  // Byte equality: the icon an MCP client fetches and the icon Android installs are one artwork.
  expect(decoded(payload).equals(readFileSync(file)), REGENERATE).toBe(true);
});

describe('the ICO container', () => {
  it('points each of its three entries at its own intact PNG, with no gap between them', () => {
    const ico = decoded(MARK_ICO_BASE64);
    const count = ico.readUInt16LE(4);
    let expected = 6 + 16 * count;
    const sizes: number[] = [];

    for (let index = 0; index < count; index += 1) {
      const entry = 6 + 16 * index;
      // A dimension of 0 means 256 — the largest the format's single byte can express.
      sizes.push(ico.readUInt8(entry) || 256);
      const bytes = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(offset, `entry ${String(index)} offset`).toBe(expected);
      expect(ico.subarray(offset, offset + PNG_SIGNATURE.length).equals(PNG_SIGNATURE)).toBe(true);
      expected += bytes;
    }

    expect(sizes).toEqual([16, 32, 48]);
    expect(ico.byteLength).toBe(expected);
  });

  it('refuses a rendition the format cannot address', () => {
    expect(() => icoFromPngs([{ size: 512, png: PNG_SIGNATURE }])).toThrow(RangeError);
    expect(() => icoFromPngs([])).toThrow(RangeError);
  });
});
