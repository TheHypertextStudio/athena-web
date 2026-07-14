'use client';

import { Button } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { useAuthenticationInterlock } from '@/components/authentication-interlock';
import { AuthenticationRequiredError } from '@/lib/query';
import { readProblemError, userErrorMessage } from '@/lib/problem';

import { useReauth } from './use-reauth';

/** Read a safe local ZIP filename from a binary download response. */
function downloadFilename(response: Response): string {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const quoted = /filename\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(disposition);
  let candidate = quoted?.[1] ?? quoted?.[2] ?? 'docket-export.zip';
  if (encoded) {
    try {
      candidate = decodeURIComponent(encoded);
    } catch {
      // A malformed optional filename must never prevent the archive from downloading.
    }
  }
  const safe = Array.from(candidate, (character) =>
    character === '\\' || character === '/' || character.charCodeAt(0) < 32 ? '_' : character,
  )
    .join('')
    .trim();
  return safe || 'docket-export.zip';
}

/** Convert a failed binary response into the same structured errors used by typed API calls. */
async function downloadError(response: Response): Promise<Error> {
  const error = await readProblemError(response, 'Could not download your export.');
  if (response.status === 401 && error.code === 'unauthorized') {
    return new AuthenticationRequiredError({
      message: 'Authentication is required. Please sign in again.',
      status: response.status,
      code: error.code,
    });
  }
  return error;
}

/** Step up with a passkey, then fetch and save the ZIP without opening a raw API response. */
export function SecureExportDownloadButton({
  downloadUrl,
}: {
  /** Same-origin binary export endpoint. */
  readonly downloadUrl: string;
}): JSX.Element {
  const reauth = useReauth();
  const { requireAuthentication } = useAuthenticationInterlock();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await reauth();
      const response = await fetch(downloadUrl, { credentials: 'include' });
      if (!response.ok) throw await downloadError(response);

      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = downloadFilename(response);
      anchor.style.display = 'none';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (caught) {
      if (caught instanceof AuthenticationRequiredError) {
        requireAuthentication();
        return;
      }
      setError(userErrorMessage(caught, 'Could not download your export.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        disabled={busy}
        onClick={() => {
          void download();
        }}
      >
        {busy ? 'Verifying…' : 'Download your data'}
      </Button>
      {error ? (
        <p role="alert" className="text-destructive text-body">
          {error}
        </p>
      ) : null}
    </div>
  );
}
