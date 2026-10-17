/** Bounded inert-text handling; no document engine, scripts, formulas or links are evaluated. */
import { defaultHttpClient, type HttpClient } from './http';

/** Maximum bytes in one supported native-mail attachment. */
export const MAIL_ATTACHMENT_MAX_BYTES = 65_536;
/** Maximum files processed for one email (and one approved outgoing email). */
export const MAIL_ATTACHMENT_MAX_COUNT = 5;
const TYPES: Readonly<Record<string, string>> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
};
/** Validate the extension/type pair before downloading or decoding a sender's file. */
export function supportedTextAttachment(filename: string, contentType: string | null): boolean {
  if (
    !filename ||
    filename.length > 180 ||
    /[/\\]/.test(filename) ||
    hasForbiddenControl(filename, true)
  )
    return false;
  const extension = /\.[^.]+$/.exec(filename.toLowerCase())?.[0] ?? '';
  return TYPES[extension] === contentType?.split(';')[0]?.trim().toLowerCase();
}
/** Strictly decode bounded UTF-8 data as inert text; callers must preserve untrusted provenance.
 * @throws Error for binary/unsupported/oversized data. No malware scanning is claimed.
 */
export function validateTextAttachment(
  filename: string,
  contentType: string | null,
  bytes: Uint8Array,
): { text: string } {
  if (!supportedTextAttachment(filename, contentType) || bytes.length > MAIL_ATTACHMENT_MAX_BYTES)
    throw new Error('attachment_unsupported');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  // Permit only ordinary text controls; reject nulls, executable binary signatures and bidi overrides.
  if (hasForbiddenControl(text)) throw new Error('attachment_invalid_text');
  return { text };
}
function hasForbiddenControl(value: string, allControls = false): boolean {
  for (const char of value) {
    if (allControls ? char.charCodeAt(0) < 32 : forbiddenTextControl(char)) return true;
  }
  return false;
}
function forbiddenTextControl(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code < 32 && ![9, 10, 13].includes(code)) ||
    code === 127 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}
async function boundedBytes(response: Response): Promise<Uint8Array> {
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get('content-length') ?? 0) > MAIL_ATTACHMENT_MAX_BYTES
  )
    throw new Error('attachment_retrieval_failed');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      const chunk: unknown = item.value;
      if (!(chunk instanceof Uint8Array)) throw new Error('attachment_invalid_bytes');
      size += chunk.byteLength;
      if (size > MAIL_ATTACHMENT_MAX_BYTES) throw new Error('attachment_too_large');
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
/** Retrieve only a provider-authorized attachment URL on Resend's exact CDN origin/path.
 * @param config - Provider API credential, never sent to the CDN.
 * @param emailId - Persisted provider email identity.
 * @param attachmentId - Persisted provider attachment identity.
 * @param http - Injectable network boundary.
 * @throws Error on mismatched metadata, redirects, other hosts or excessive bytes.
 */
export async function retrieveResendAttachment(
  config: { apiKey: string },
  emailId: string,
  attachmentId: string,
  http: HttpClient = defaultHttpClient,
): Promise<Uint8Array> {
  const path = `${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`;
  const response = await http(`https://api.resend.com/emails/receiving/${path}`, {
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!response.ok) throw new Error('attachment_retrieval_failed');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object') throw new Error('attachment_invalid_metadata');
  const meta = value as Record<string, unknown>;
  const url = attachmentUrl(meta, attachmentId, path);
  const bytes = await boundedBytes(
    await http(url.href, { signal: AbortSignal.timeout(10_000), redirect: 'error' }),
  );
  if (bytes.byteLength !== meta['size']) throw new Error('attachment_size_mismatch');
  return bytes;
}

function attachmentUrl(meta: Record<string, unknown>, id: string, path: string): URL {
  if (
    meta['id'] !== id ||
    typeof meta['size'] !== 'number' ||
    !Number.isSafeInteger(meta['size']) ||
    meta['size'] < 0 ||
    meta['size'] > MAIL_ATTACHMENT_MAX_BYTES ||
    typeof meta['download_url'] !== 'string'
  )
    throw new Error('attachment_invalid_metadata');
  const url = providerDownloadUrl(meta['download_url']);
  if (
    url.origin !== 'https://inbound-cdn.resend.com' ||
    url.username ||
    url.password ||
    url.pathname !== `/${path}`
  )
    throw new Error('attachment_invalid_url');
  return url;
}

function providerDownloadUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error('attachment_invalid_url');
  }
}
