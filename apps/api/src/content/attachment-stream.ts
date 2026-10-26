import { createHash } from 'node:crypto';
import type { attachment } from '@docket/db';
import type { BlobRange } from '@docket/blob-store';
import { getContainer } from '../container';
import { NotFoundError } from '../error';

function parseRange(value: string, size: number): BlobRange | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size
  )
    return null;
  return { start, end };
}
/** Stream an already-authorized file, supporting one inclusive range without whole-object reads. */
export async function attachmentStream(
  row: typeof attachment.$inferSelect,
  rangeHeader?: string,
  inline = false,
): Promise<Response> {
  if (!row.blobKey || row.kind !== 'file') throw new NotFoundError();
  const blob = getContainer().blob;
  const metadata = await blob.transfer.stat(row.blobKey);
  if (!metadata) throw new NotFoundError();
  const range = rangeHeader ? parseRange(rangeHeader, metadata.byteSize) : undefined;
  const headers = fileHeaders(row, inline);
  // The immutable provider generation supplies a validator without middleware buffering the stream.
  const tag = createHash('sha256')
    .update(JSON.stringify([row.id, metadata.generation, metadata.byteSize, metadata.crc32c]))
    .digest('hex');
  headers.set('ETag', `"${tag}"`);
  if (range === null) {
    headers.set('Content-Range', `bytes */${metadata.byteSize}`);
    return new Response(null, { status: 416, headers });
  }
  if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${metadata.byteSize}`);
  headers.set('Content-Length', String(range ? range.end - range.start + 1 : metadata.byteSize));
  return new Response(await blob.transfer.stream(row.blobKey, range), {
    status: range ? 206 : 200,
    headers,
  });
}

function fileHeaders(row: typeof attachment.$inferSelect, inline: boolean): Headers {
  return new Headers({
    'Content-Type': row.mimeType ?? 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.fileName ?? 'download')}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    ...(inline
      ? {
          'Content-Security-Policy':
            "sandbox; default-src 'none'; img-src 'self'; media-src 'self'",
        }
      : {}),
  });
}
