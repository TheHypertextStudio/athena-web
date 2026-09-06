/**
 * The mark as a multi-size `.ico`.
 *
 * @remarks
 * `/favicon.ico` is the one icon URL a consumer guesses rather than reads, and nothing else here
 * produces one. Entries are stored PNG-encoded, which every consumer since Windows Vista reads.
 *
 * Not exported from the package index: it rasterizes through `sharp`, and the API imports the mark
 * as bytes precisely so nothing native reaches its bundle.
 */
import sharp from 'sharp';

import { platedMarkSvg } from './svg';

/** One rendition inside the container. */
export interface IcoRendition {
  /** Edge length in pixels. */
  readonly size: number;
  readonly png: Uint8Array;
}

/** Browser tab, Retina tab, and Windows shortcut. */
const ICO_SIZES = [16, 32, 48] as const;

/** Bytes in the `ICONDIR` header. */
const DIRECTORY_HEADER_BYTES = 6;

/** Bytes in each `ICONDIRENTRY`. */
const DIRECTORY_ENTRY_BYTES = 16;

/**
 * Wrap PNG renditions in an ICO container.
 *
 * @param renditions - What to carry, in the order to list it.
 * @returns The complete `.ico` file.
 * @throws RangeError if there are no renditions, or one exceeds the format's 256px limit.
 */
export function icoFromPngs(renditions: readonly IcoRendition[]): Buffer {
  if (renditions.length === 0) throw new RangeError('An ICO must carry at least one rendition.');

  const header = Buffer.alloc(DIRECTORY_HEADER_BYTES);
  header.writeUInt16LE(0, 0);
  // 1 is an icon; 2 is a cursor, which carries a hotspot where the plane/depth fields are.
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(renditions.length, 4);

  let offset = DIRECTORY_HEADER_BYTES + DIRECTORY_ENTRY_BYTES * renditions.length;
  const directory = renditions.map(({ size, png }) => {
    if (size > 256) throw new RangeError(`An ICO rendition cannot exceed 256px; got ${size}.`);
    const entry = Buffer.alloc(DIRECTORY_ENTRY_BYTES);
    // A dimension is one byte, so 256 is written as 0.
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.byteLength, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.byteLength;
    return entry;
  });

  return Buffer.concat([
    header,
    ...directory,
    ...renditions.map((rendition) => Buffer.from(rendition.png)),
  ]);
}

/**
 * Render the mark as a `.ico`.
 *
 * @remarks
 * Each rendition is authored at its output size, because resampling 48px down to 16 smears the 1px
 * gap `COVERAGE` exists to protect.
 *
 * @returns The complete `.ico` file.
 */
export async function markIco(): Promise<Buffer> {
  const renditions = await Promise.all(
    ICO_SIZES.map(async (size) => ({
      size,
      png: await sharp(Buffer.from(platedMarkSvg(size)))
        .png()
        .toBuffer(),
    })),
  );
  return icoFromPngs(renditions);
}
