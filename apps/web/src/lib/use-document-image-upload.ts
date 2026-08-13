'use client';

/**
 * `lib/use-document-image-upload` — rehosting an image that arrived on the clipboard.
 *
 * @remarks
 * A pasted screenshot arrives as bytes with no home. They are uploaded, and the Markdown records the
 * URL they became addressable at — see `apps/api/src/routes/document-images`.
 *
 * The upload resolves after the paste gesture is over and can fail: the image is too large, the
 * network is gone, the workspace is read-only. The hook holds a small state machine and the sentence
 * describing it; the editor renders both.
 *
 * @see {@link ../components/editor/markdown-clipboard} for the paste handler that calls this.
 */
import type { DocumentImageOut } from '@docket/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from './api';
import type { PastedImageUploader } from '@/components/editor/markdown-clipboard';
import { unwrap } from './query';

/** Where a pasted image currently stands. */
export type DocumentImageUploadStatus = 'idle' | 'uploading' | 'failed';

/** What {@link useDocumentImageUpload} exposes. */
export interface DocumentImageUpload {
  /**
   * The uploader to hand the editor, or `null` when there is nowhere to upload to.
   *
   * @remarks
   * `null` outside a workspace, which the paste handler reads as "decline this paste".
   */
  readonly upload: PastedImageUploader | null;
  /** The current upload state, for a visible indicator. */
  readonly status: DocumentImageUploadStatus;
  /** The sentence to announce politely, or `''` when there is nothing to say. */
  readonly announcement: string;
}

/** Application-owned copy for the two states worth announcing. */
const UPLOADING_MESSAGE = 'Uploading pasted image…';
const FAILED_MESSAGE = 'Could not upload that image. Try pasting it again.';

/**
 * Provide an uploader for images pasted into prose.
 *
 * @param orgId - The workspace to store into, or `undefined` outside one.
 * @returns The uploader and its observable status.
 *
 * @example
 * ```tsx
 * const images = useDocumentImageUpload(orgId);
 * createMarkdownClipboardExtension({ uploadImage: images.upload });
 * ```
 */
export function useDocumentImageUpload(orgId: string | undefined): DocumentImageUpload {
  const [status, setStatus] = useState<DocumentImageUploadStatus>('idle');
  // An upload resolves long after the paste; the surface may be gone by then.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const upload = useCallback(
    async (file: File): Promise<string | null> => {
      if (orgId === undefined) return null;
      setStatus('uploading');
      try {
        const created: DocumentImageOut = await unwrap(
          () => api.v1.orgs[':orgId'].images.$post({ param: { orgId }, form: { file } }),
          'Could not upload that image.',
        );
        if (mountedRef.current) setStatus('idle');
        return created.url;
      } catch {
        // The message is application-owned and fixed.
        if (mountedRef.current) setStatus('failed');
        return null;
      }
    },
    [orgId],
  );

  return useMemo(
    () => ({
      upload: orgId === undefined ? null : upload,
      status,
      announcement:
        status === 'uploading' ? UPLOADING_MESSAGE : status === 'failed' ? FAILED_MESSAGE : '',
    }),
    [orgId, upload, status],
  );
}
