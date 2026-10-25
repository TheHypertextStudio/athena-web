/** Fingerprint one content request without persisting its prose in browser storage.
 * @param value - The request fields whose unchanged fingerprint can reuse a key.
 * @returns A stable digest of the request fields.
 */
async function contentPostFingerprint(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Keep one request key across an unchanged post retry without storing its prose in browser storage.
 * @param scope - The organization and subject that own the pending write.
 * @param value - The request fields whose unchanged fingerprint may reuse the key.
 * @returns A reusable idempotency key for this exact post input.
 */
export async function contentPostRequestKey(scope: string, value: unknown): Promise<string> {
  const fingerprint = await contentPostFingerprint(value);
  const storageKey = `docket:content-post:${scope}`;
  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as { fingerprint?: unknown; key?: unknown };
      if (parsed.fingerprint === fingerprint && typeof parsed.key === 'string') return parsed.key;
    }
    const key = crypto.randomUUID();
    sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, key }));
    return key;
  } catch {
    return crypto.randomUUID();
  }
}

/** Remove a completed post key without disturbing a newer draft's key.
 * @param scope - The organization and subject that own the pending write.
 * @param value - The completed request fields.
 * @param requestKey - The key returned for the completed request.
 * @returns A promise that settles after the matching saved key is removed.
 */
export async function clearContentPostRequestKey(
  scope: string,
  value: unknown,
  requestKey: string,
): Promise<void> {
  const fingerprint = await contentPostFingerprint(value);
  const storageKey = `docket:content-post:${scope}`;
  try {
    const stored = sessionStorage.getItem(storageKey);
    if (!stored) return;
    const parsed = JSON.parse(stored) as { fingerprint?: unknown; key?: unknown };
    if (parsed.fingerprint !== fingerprint || parsed.key !== requestKey) return;
    sessionStorage.removeItem(storageKey);
  } catch {
    // Storage can be unavailable in a private browsing context; the accepted post remains saved.
  }
}
