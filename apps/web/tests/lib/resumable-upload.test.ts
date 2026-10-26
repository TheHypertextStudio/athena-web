import { failurePresentation } from '../../src/lib/failure-presentation';
import { AttachmentId } from '@docket/work/ids';
import type { ChunkTransfer } from '../../src/lib/resumable-upload';
import { File as NodeFile } from 'node:buffer';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  transferFile,
  sendUploadChunk,
  type UploadControl,
  type TransferReceipt,
} from '../../src/lib/resumable-upload';

beforeEach(() => vi.stubGlobal('File', NodeFile));
afterEach(() => vi.unstubAllGlobals());

const fileResult = {
  id: AttachmentId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  title: 'Report',
  fileName: 'report.txt',
  mimeType: 'text/plain',
  byteSize: 9,
  downloadUrl: '/download',
};
const pending: TransferReceipt = {
  id: 'session',
  state: 'pending',
  offset: 3,
  byteSize: 9,
  chunkSize: 8 * 1024 * 1024,
  uploadUrl: 'https://storage.googleapis.com/secret',
};
function control(): UploadControl {
  return {
    begin: vi.fn().mockResolvedValue(pending),
    status: vi.fn().mockResolvedValue(pending),
    complete: vi.fn().mockResolvedValue({ ...pending, state: 'completed', file: fileResult }),
    cancel: vi.fn(),
  };
}
describe('one resumable browser transfer', () => {
  it('resumes from acknowledged bytes and finalizes without repeating the prefix', async () => {
    const api = control();
    const chunks: string[] = [];
    const progress: number[] = [];
    const file = new File(['123456789'], 'report.txt', { type: 'text/plain' });
    const send = vi.fn(async (input: ChunkTransfer) => {
      chunks.push(await input.bytes.text());
      return 9;
    });
    expect(
      await transferFile(
        {
          file,
          requestId: 'stable',
          destination: { kind: 'draft' },
          control: api,
          onProgress: (n) => progress.push(n),
        },
        send,
      ),
    ).toEqual(fileResult);
    expect(chunks).toEqual(['456789']);
    expect(api.begin).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'stable', byteSize: 9, crc32c: '4waSgw==' }),
    );
    expect(progress.at(-1)).toBe(100);
  });
  it('recovers a lost completion response through the same begin identity', async () => {
    const api = control();
    vi.mocked(api.begin).mockResolvedValue({ ...pending, state: 'completed', file: fileResult });
    const send = vi.fn();
    expect(
      await transferFile(
        {
          file: new File(['123456789'], 'report.txt'),
          requestId: 'stable',
          destination: { kind: 'draft' },
          control: api,
        },
        send,
      ),
    ).toEqual(fileResult);
    expect(send).not.toHaveBeenCalled();
    expect(api.complete).not.toHaveBeenCalled();
  });
  it('uses provider acknowledgement even when only part of a chunk arrived', async () => {
    const api = control();
    vi.mocked(api.begin).mockResolvedValue({ ...pending, offset: 0 });
    const offsets: number[] = [];
    await transferFile(
      {
        file: new File(['123456789'], 'report.txt'),
        requestId: 'stable',
        destination: { kind: 'draft' },
        control: api,
      },
      async ({ offset }) => {
        offsets.push(offset);
        return offset === 0 ? 3 : 9;
      },
    );
    expect(offsets).toEqual([0, 3]);
  });
  it('pauses without completion and rejects files above the 100 MiB ceiling before allocation', async () => {
    const api = control();
    const abort = new AbortController();
    abort.abort();
    await expect(
      transferFile({
        file: new File(['123'], 'report.txt'),
        requestId: 'stable',
        destination: { kind: 'draft' },
        control: api,
        signal: abort.signal,
      }),
    ).rejects.toThrow();
    const file = new File(['x'], 'huge.bin');
    Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 + 1 });
    await expect(
      transferFile({ file, requestId: 'huge', destination: { kind: 'draft' }, control: api }),
    ).rejects.toThrow();
    expect(api.begin).not.toHaveBeenCalled();
    expect(api.complete).not.toHaveBeenCalled();
  });
  it('keeps Docket cookies and headers out of provider chunk requests', async () => {
    const headers: Record<string, string> = {};
    class Request {
      withCredentials = true;
      status = 308;
      upload = { onprogress: null };
      onload: (() => void) | null = null;
      onerror = null;
      onabort = null;
      open = vi.fn();
      abort = vi.fn();
      setRequestHeader(name: string, value: string): void {
        headers[name] = value;
      }
      getResponseHeader(): string {
        return 'bytes=0-8';
      }
      send(): void {
        expect(this.withCredentials).toBe(false);
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', Request);
    expect(
      await sendUploadChunk({
        session: pending,
        bytes: new Blob(['123456789']),
        offset: 0,
        total: 9,
        onProgress: vi.fn(),
      }),
    ).toBe(9);
    expect(headers).toEqual({ 'Content-Range': 'bytes 0-8/9' });
  });
  it.each([503, 0])(
    'makes a failed storage chunk (%s) retryable through the shared mutation notice',
    async (status) => {
      class Request {
        withCredentials = false;
        status = status;
        upload = { onprogress: null };
        onload: (() => void) | null = null;
        onerror = null;
        onabort = null;
        open = vi.fn();
        abort = vi.fn();
        setRequestHeader = vi.fn();
        send(): void {
          this.onload?.();
        }
      }
      vi.stubGlobal('XMLHttpRequest', Request);
      const error: unknown = await sendUploadChunk({
        session: pending,
        bytes: new Blob(['123']),
        offset: 0,
        total: 9,
        onProgress: vi.fn(),
      }).catch((caught: unknown) => caught);
      expect(failurePresentation(error, 'Could not upload the file.').canRetry).toBe(true);
    },
  );
});
