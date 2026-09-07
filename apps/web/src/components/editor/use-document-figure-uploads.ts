'use client';

import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DocumentFigureActions } from './document-figure-node-view';
import { DOCUMENT_FIGURE_NODE, pendingDocumentFigure } from './document-figure-extension';
import type { PastedImageUploader } from './markdown-clipboard';

interface RetainedUpload {
  readonly file: File;
  readonly previewSrc: string;
}

const MAX_DOCUMENT_IMAGE_BYTES = 4 * 1024 * 1024;
const DOCUMENT_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Return fixed application copy when a file cannot enter the raster upload pipeline. */
function imageFileIssue(file: File): string | null {
  if (!DOCUMENT_IMAGE_MIME_TYPES.has(file.type)) {
    return 'Images must be PNG, JPEG, GIF, or WebP.';
  }
  if (file.size === 0) return 'The image is empty.';
  if (file.size > MAX_DOCUMENT_IMAGE_BYTES) return 'Images must be 4 MB or smaller.';
  return null;
}

/** The figure upload controller shared by browse, paste, drop, retry, and replacement. */
export interface DocumentFigureUploads {
  /** Insert selected files at one document position and start every upload. */
  readonly insert: (files: readonly File[], position?: number) => boolean;
  /** Actions consumed by each figure node view. */
  readonly actions: DocumentFigureActions;
  /** Polite status announcement for assistive technology. */
  readonly announcement: string;
}

let nextUploadId = 0;

/** Create a session-local identifier that survives position remapping and undo. */
function uploadId(): string {
  nextUploadId += 1;
  return `figure-upload-${String(nextUploadId)}`;
}

/** Create a local preview when the browser supports object URLs. */
function previewFor(file: File): string {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
}

/** Release one preview without requiring support in jsdom or older browsers. */
function releasePreview(src: string): void {
  if (src && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(src);
}

/** Find one pending figure by its stable upload id. */
function figurePosition(editor: Editor, id: string): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === DOCUMENT_FIGURE_NODE && node.attrs['uploadId'] === id) {
      found = position;
      return false;
    }
    return found === null;
  });
  return found;
}

/** Patch a figure's attributes without moving the current selection. */
function patchFigure(editor: Editor, position: number, patch: Record<string, unknown>): void {
  const node = editor.state.doc.nodeAt(position);
  if (node?.type.name !== DOCUMENT_FIGURE_NODE) return;
  editor.view.dispatch(
    editor.state.tr
      .setNodeMarkup(position, undefined, { ...node.attrs, ...patch }, node.marks)
      .setMeta('addToHistory', false),
  );
}

/** Return whether an editor can still receive the result of an asynchronous upload. */
function editorIsUsable(editor: Editor | null): editor is Editor {
  return editor !== null && !editor.isDestroyed;
}

/** Read every dependency required to start one retained upload. */
function uploadContext(
  retained: RetainedUpload | undefined,
  editor: Editor | null,
  upload: PastedImageUploader | null,
): { retained: RetainedUpload; editor: Editor; upload: PastedImageUploader } | null {
  if (retained === undefined || !editorIsUsable(editor) || upload === null) return null;
  return { retained, editor, upload };
}

/** Coordinate every path that places uploaded bytes into a semantic figure node. */
export function useDocumentFigureUploads(
  editor: Editor | null,
  upload: PastedImageUploader | null,
): DocumentFigureUploads {
  const retainedRef = useRef(new Map<string, RetainedUpload>());
  const editorRef = useRef(editor);
  const uploadRef = useRef(upload);
  const [announcement, setAnnouncement] = useState('');
  editorRef.current = editor;
  uploadRef.current = upload;

  useEffect(
    () => () => {
      retainedRef.current.forEach((retained) => {
        releasePreview(retained.previewSrc);
      });
      retainedRef.current.clear();
    },
    [],
  );

  const start = useCallback(async (id: string): Promise<void> => {
    const context = uploadContext(
      retainedRef.current.get(id),
      editorRef.current,
      uploadRef.current,
    );
    if (context === null) return;
    const { retained, editor: currentEditor, upload: currentUpload } = context;
    const before = figurePosition(currentEditor, id);
    if (before === null) return;
    patchFigure(currentEditor, before, { status: 'uploading' });
    setAnnouncement(`Uploading ${retained.file.name || 'image'}…`);
    const src = await currentUpload(retained.file);
    const liveEditor = editorRef.current;
    if (!editorIsUsable(liveEditor)) return;
    const position = figurePosition(liveEditor, id);
    if (position === null) {
      releasePreview(retained.previewSrc);
      retainedRef.current.delete(id);
      return;
    }
    if (!src) {
      patchFigure(liveEditor, position, { status: 'failed' });
      setAnnouncement(
        `Could not upload ${retained.file.name || 'that image'}. Retry or remove it.`,
      );
      return;
    }
    patchFigure(liveEditor, position, {
      src,
      status: 'ready',
      uploadId: '',
      previewSrc: '',
      fileName: retained.file.name,
    });
    releasePreview(retained.previewSrc);
    retainedRef.current.delete(id);
    setAnnouncement(`${retained.file.name || 'Image'} uploaded.`);
  }, []);

  const insert = useCallback(
    (files: readonly File[], position?: number): boolean => {
      const currentEditor = editorRef.current;
      if (!currentEditor || !uploadRef.current || files.length === 0) return false;
      const accepted = files.filter((file) => imageFileIssue(file) === null);
      if (accepted.length === 0) {
        const first = files[0];
        setAnnouncement(first ? (imageFileIssue(first) ?? 'Could not add the image.') : '');
        return true;
      }
      const ids = accepted.map(() => uploadId());
      const figures = accepted.map((file, index) => {
        const id = ids[index] ?? uploadId();
        const previewSrc = previewFor(file);
        retainedRef.current.set(id, { file, previewSrc });
        return pendingDocumentFigure(file, id, previewSrc);
      });
      const at = position ?? currentEditor.state.selection.from;
      if (!currentEditor.commands.insertContentAt(at, figures)) {
        ids.forEach((id) => {
          const retained = retainedRef.current.get(id);
          if (retained) releasePreview(retained.previewSrc);
          retainedRef.current.delete(id);
        });
        return false;
      }
      ids.forEach((id) => void start(id));
      return true;
    },
    [start],
  );

  const actions = useMemo<DocumentFigureActions>(
    () => ({
      replace: (position, file) => {
        const currentEditor = editorRef.current;
        if (!currentEditor || !uploadRef.current) return;
        const issue = imageFileIssue(file);
        if (issue !== null) {
          setAnnouncement(issue);
          return;
        }
        const id = uploadId();
        const previewSrc = previewFor(file);
        retainedRef.current.set(id, { file, previewSrc });
        patchFigure(currentEditor, position, {
          status: 'uploading',
          uploadId: id,
          previewSrc,
          fileName: file.name,
        });
        void start(id);
      },
      retry: (id) => {
        void start(id);
      },
      forget: (id) => {
        const retained = retainedRef.current.get(id);
        if (retained) releasePreview(retained.previewSrc);
        retainedRef.current.delete(id);
      },
    }),
    [start],
  );

  return { insert, actions, announcement };
}
