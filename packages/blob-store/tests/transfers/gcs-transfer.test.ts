import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { GcsTransfer } from '../../src/gcs-transfer';

function provider() {
  const object = {
    createResumableUpload: vi
      .fn()
      .mockResolvedValue(['https://storage.googleapis.com/upload/secret']),
    getMetadata: vi.fn().mockResolvedValue([{ size: '9', crc32c: '4waSgw==', generation: '41' }]),
    createReadStream: vi.fn().mockImplementation(() => Readable.from([Buffer.from('3456')])),
    copy: vi.fn().mockResolvedValue([]),
  };
  const file = vi.fn(() => object);
  return { object, bucket: { file } };
}
describe('GCS resumable transfer boundary', () => {
  it('pins object creation, expected length and integrity at session creation', async () => {
    const p = provider();
    const transfer = new GcsTransfer(p.bucket, fetch, 'https://docket.example');
    expect(
      await transfer.begin('opaque/key', {
        byteSize: 9,
        crc32c: '4waSgw==',
        contentType: 'text/plain',
      }),
    ).toBe('https://storage.googleapis.com/upload/secret');
    expect(p.object.createResumableUpload).toHaveBeenCalledWith({
      preconditionOpts: { ifGenerationMatch: 0 },
      origin: 'https://docket.example',
      metadata: {
        contentLength: 9,
        crc32c: '4waSgw==',
        contentType: 'text/plain',
        cacheControl: 'private, no-store',
      },
    });
    expect(await transfer.stat('opaque/key')).toEqual({
      byteSize: 9,
      crc32c: '4waSgw==',
      generation: '41',
    });
  });
  it('probes acknowledged provider bytes without downloading an object', async () => {
    const p = provider();
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 308, headers: { Range: 'bytes=0-262143' } }));
    const transfer = new GcsTransfer(p.bucket, request);
    expect(
      await transfer.status(
        'key',
        { byteSize: 900000, crc32c: 'AAAAAA==', contentType: 'text/plain' },
        'https://storage.googleapis.com/upload/secret',
      ),
    ).toEqual({ offset: 262144, complete: false });
    expect(request).toHaveBeenCalledWith(
      'https://storage.googleapis.com/upload/secret',
      expect.objectContaining({
        method: 'PUT',
        redirect: 'manual',
        headers: { 'Content-Length': '0', 'Content-Range': 'bytes */900000' },
      }),
    );
  });
  it('streams ranges and copies with destination generation protection', async () => {
    const p = provider();
    const transfer = new GcsTransfer(p.bucket);
    expect(await new Response(await transfer.stream('key', { start: 2, end: 5 })).text()).toBe(
      '3456',
    );
    await transfer.copy('key', 'other', 'text/plain');
    expect(p.object.createReadStream).toHaveBeenCalledWith({ start: 2, end: 5 });
    expect(p.object.copy).toHaveBeenCalledWith(
      p.object,
      expect.objectContaining({ preconditionOpts: { ifGenerationMatch: 0 } }),
    );
  });
  it('treats only acknowledged cancellation as complete and preserves failures for retry', async () => {
    const p = provider();
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 499 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const transfer = new GcsTransfer(p.bucket, request);
    await expect(
      transfer.cancel('key', 'https://storage.googleapis.com/upload/secret'),
    ).resolves.toBeUndefined();
    await expect(
      transfer.cancel('key', 'https://storage.googleapis.com/upload/secret'),
    ).rejects.toThrow();
  });
  it('acknowledges only a confirmed terminal invalid session after provider integrity rejection', async () => {
    const invalid = () =>
      Response.json({ error: { code: 400, errors: [{ reason: 'invalid' }] } }, { status: 400 });
    const request = vi
      .fn()
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(new Response(null, { status: 308 }))
      .mockResolvedValueOnce(
        Response.json({ error: { code: 400, errors: [{ reason: 'other' }] } }, { status: 400 }),
      );
    const transfer = new GcsTransfer(provider().bucket, request);
    const uri = 'https://storage.googleapis.com/upload/secret';
    await expect(transfer.cancel('key', uri)).resolves.toBeUndefined();
    expect(request).toHaveBeenNthCalledWith(
      2,
      uri,
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Length': '0', 'Content-Range': 'bytes */*' },
      }),
    );
    await expect(transfer.cancel('key', uri)).rejects.toThrow();
    await expect(transfer.cancel('key', uri)).rejects.toThrow();
  });
  it('handles completed, empty and invalid provider acknowledgements without assuming sent bytes', async () => {
    const p = provider();
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 308 }))
      .mockResolvedValueOnce(new Response(null, { status: 308, headers: { Range: 'invalid' } }))
      .mockResolvedValueOnce(new Response(null, { status: 308, headers: { Range: 'bytes=0-999' } }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const transfer = new GcsTransfer(p.bucket, request);
    const options = { byteSize: 9, crc32c: '4waSgw==', contentType: 'text/plain' };
    const uri = 'https://storage.googleapis.com/upload/secret';
    expect(await transfer.status('key', options, uri)).toEqual({ offset: 9, complete: true });
    expect(await transfer.status('key', options, uri)).toEqual({ offset: 0, complete: false });
    await expect(transfer.status('key', options, uri)).rejects.toThrow();
    await expect(transfer.status('key', options, uri)).rejects.toThrow();
    await expect(transfer.status('key', options, uri)).rejects.toThrow();
    await expect(transfer.status('key', options, null)).rejects.toThrow();
    await transfer.cancel('key', null);
  });
  it('distinguishes missing objects, incomplete metadata and provider failures', async () => {
    const p = provider();
    const transfer = new GcsTransfer(p.bucket);
    p.object.getMetadata.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 404 }));
    expect(await transfer.stat('missing')).toBeNull();
    p.object.getMetadata.mockResolvedValueOnce([{ size: 'NaN' }]);
    await expect(transfer.stat('invalid')).rejects.toThrow();
    p.object.getMetadata.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 403 }));
    await expect(transfer.stat('denied')).rejects.toThrow();
  });
});
