import { describe, expect, it } from 'vitest';
import { openUploadCapability, sealUploadCapability } from '../../src/content/upload-crypto';

describe('upload capability encryption', () => {
  it('seals credentials at rest and binds them to their reserved session', () => {
    const secret = 'https://storage.googleapis.com/upload?upload_id=private';
    const sealed = sealUploadCapability('session', secret);
    expect(sealed).not.toContain('storage.googleapis.com');
    expect(openUploadCapability('session', sealed)).toBe(secret);
    expect(() => openUploadCapability('another-session', sealed)).toThrow();
    const bytes = Buffer.from(sealed, 'base64url');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    expect(() => openUploadCapability('session', bytes.toString('base64url'))).toThrow();
  });
});
