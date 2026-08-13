'use client';

/**
 * `lib/use-document-image-upload` — rehosting an image that arrived on the clipboard.
 *
 * @remarks
 * Pasting a screenshot into a body has to end with the image stored somewhere every reader of that
 * body can reach. The clipboard hands over bytes with no home, so those bytes are uploaded and the
 * Markdown records the URL they became addressable at — see `apps/api/src/routes/document-images`.
 *
 * ## Why this reports its own status
 *
 * An upload is the one part of paste that can fail *after* the gesture is over: the image is too
 * large, the network is gone, the workspace is not writable. Failing silently there is the worst
 * available outcome — the user watched themselves paste a screenshot, saw nothing appear, and has
 * no idea whether to try again. So the hook owns a small state machine and the sentence describing
 * it, and the editor renders both.
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
   * `null` outside a workspace rather than a function that always fails. The paste handler treats
   * an absent uploader as "decline this paste", which lets the browser's default behavior stand
   * instead of consuming the gesture and then reporting an error the user cannot act on.
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
        // The message is application-owned and fixed; nothing from the failure is rendered.
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
