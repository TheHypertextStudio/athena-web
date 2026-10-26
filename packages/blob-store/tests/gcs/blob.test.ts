import { describe, expect, it, vi } from 'vitest';

import { GcsBlob, type GcsBucket } from '../../src/gcs';

/** In-memory provider edge that preserves object bytes and metadata. */
function storage() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  let failure: Error | undefined;
  const bucket: GcsBucket = {
    file: (key) => ({
      createResumableUpload: vi.fn(),
      getMetadata: vi.fn(),
      createReadStream: vi.fn(),
      copy: vi.fn(),
      save: async (bytes, options) => {
        if (failure) throw failure;
        objects.set(key, {
          bytes: new Uint8Array(bytes),
          ...(options.metadata.contentType ? { contentType: options.metadata.contentType } : {}),
        });
      },
      download: async () => {
        if (failure) throw failure;
        const object = objects.get(key);
        if (!object) throw Object.assign(new Error('missing'), { code: 404 });
        return [object.bytes];
      },
      delete: async () => {
        if (failure) throw failure;
        objects.delete(key);
      },
    }),
  };
  return {
    bucket,
    objects,
    fail: (cause: Error) => {
      failure = cause;
    },
  };
}

describe('GcsBlob', () => {
  it('retains exact bytes and MIME under the key and replaces the previous value', async () => {
    const provider = storage();
    const blob = new GcsBlob({ bucket: 'studio-artifacts' }, provider.bucket);
    expect(
      await blob.put('exports/account/a/1.zip', new Uint8Array([0, 255, 2]), 'application/zip'),
    ).toEqual({
      key: 'exports/account/a/1.zip',
      url: 'gs://studio-artifacts/exports/account/a/1.zip',
    });
    expect(await blob.get('exports/account/a/1.zip')).toEqual(new Uint8Array([0, 255, 2]));
    expect(provider.objects.get('exports/account/a/1.zip')?.contentType).toBe('application/zip');
    await blob.put('exports/account/a/1.zip', new Uint8Array([3]));
    expect(await blob.get('exports/account/a/1.zip')).toEqual(new Uint8Array([3]));
    expect(provider.objects.size).toBe(1);
  });

  it('returns null only for missing objects and supports repeated deletion', async () => {
    const provider = storage();
    const blob = new GcsBlob({ bucket: 'studio-artifacts' }, provider.bucket);
    expect(await blob.get('missing')).toBeNull();
    await blob.put('key', new Uint8Array([1]));
    await blob.delete('key');
    await blob.delete('key');
    expect(await blob.get('key')).toBeNull();
    provider.fail(Object.assign(new Error('missing'), { code: 404 }));
    await expect(blob.delete('missing')).resolves.toBeUndefined();
  });

  it('preserves provider failures as causes for each operation', async () => {
    const provider = storage();
    const blob = new GcsBlob({ bucket: 'studio-artifacts' }, provider.bucket);
    const cause = Object.assign(new Error('denied'), { code: 403 });
    provider.fail(cause);
    await expect(blob.get('secret')).rejects.toHaveProperty('cause', cause);
    await expect(blob.put('secret', new Uint8Array([1]))).rejects.toHaveProperty('cause', cause);
    await expect(blob.delete('secret')).rejects.toHaveProperty('cause', cause);
  });

  it('normalizes leading slashes consistently and uses an authenticated durable address', async () => {
    const provider = storage();
    const blob = new GcsBlob({ bucket: 'studio-artifacts' }, provider.bucket);
    await blob.put('/nested/image', new Uint8Array([1]));
    expect(await blob.get('nested/image')).toEqual(new Uint8Array([1]));
    expect(blob.url('/nested/image')).toBe('gs://studio-artifacts/nested/image');
    await blob.delete('/nested/image');
    expect(await blob.get('nested/image')).toBeNull();
  });
});
