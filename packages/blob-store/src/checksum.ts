/** Portable incremental CRC32C, encoded as the big-endian base64 used by object storage. */
export class Crc32c {
  private value = 0xffffffff;

  /** Include another bounded chunk without retaining the input. */
  update(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.value = (this.value >>> 8) ^ (table[(this.value ^ byte) & 255] ?? 0);
    }
  }

  /** Return the checksum without consuming this accumulator. */
  digest(): string {
    const value = (this.value ^ 0xffffffff) >>> 0;
    const bytes = [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    return btoa(String.fromCharCode(...bytes));
  }
}
const table = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0x82f63b78 : 0);
  return value >>> 0;
});
