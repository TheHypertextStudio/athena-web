import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDiskBlob } from '../../src/local-disk';
import { Crc32c } from '../../src/checksum';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
async function storage() {
  const root = await mkdtemp(join(tmpdir(), 'docket-transfer-'));
  roots.push(root);
  return new LocalDiskBlob({ root });
}
const bytes = new TextEncoder().encode('123456789');
const options = { byteSize: 9, crc32c: '4waSgw==', contentType: 'text/plain' };

describe('bounded resumable storage', () => {
  it('calculates the standard CRC32C vector incrementally', () => {
    const crc = new Crc32c();
    crc.update(bytes.slice(0, 3));
    crc.update(bytes.slice(3));
    expect(crc.digest()).toBe('4waSgw==');
    expect(new Crc32c().digest()).toBe('AAAAAA==');
  });
  it('recovers an interrupted transfer from durable acknowledged bytes', async () => {
    const blob = await storage();
    expect(await blob.transfer.begin('file', options)).toBeNull();
    await blob.transfer.append('file', options, 0, bytes.slice(0, 3));
    expect(await blob.get('file')).toBeNull();
    expect(await blob.transfer.status('file', options, null)).toEqual({
      offset: 3,
      complete: false,
    });
    await expect(blob.transfer.append('file', options, 0, bytes)).rejects.toThrow();
    await blob.transfer.append('file', options, 3, bytes.slice(3));
    expect(await blob.transfer.status('file', options, null)).toEqual({
      offset: 9,
      complete: true,
    });
    expect(await blob.transfer.stat('file')).toMatchObject({ byteSize: 9, crc32c: options.crc32c });
    expect(await blob.get('file')).toEqual(bytes);
    await expect(blob.transfer.append('file', options, 0, bytes)).rejects.toThrow();
  });
  it('does not publish corrupt or oversized bytes', async () => {
    const blob = await storage();
    await blob.transfer.begin('file', options);
    await expect(blob.transfer.append('file', options, 0, new Uint8Array(10))).rejects.toThrow();
    await expect(blob.transfer.append('file', options, 0, new Uint8Array(9))).rejects.toThrow();
    expect(await blob.get('file')).toBeNull();
    await blob.transfer.cancel('file', null);
    expect(await blob.transfer.status('file', options, null)).toEqual({
      offset: 0,
      complete: false,
    });
  });
  it('streams a range and keeps an independent copy after source deletion', async () => {
    const blob = await storage();
    await blob.put('source', bytes);
    await blob.transfer.copy('source', 'copy', 'text/plain');
    await blob.delete('source');
    const stream = await blob.transfer.stream('copy', { start: 2, end: 5 });
    expect(await new Response(stream).text()).toBe('3456');
    expect(await blob.transfer.stat('copy')).toMatchObject({ byteSize: 9, crc32c: options.crc32c });
  });
});
