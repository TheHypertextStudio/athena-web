'use client';
import { useId, useRef, type JSX } from 'react';
import { Button, Text } from '@docket/ui/primitives';

/** Keyboard-operable file selection with the accepted attachment size visible before selection. */
export function ResourceFileUpload({
  onUpload,
  pending,
  uploading,
  progress,
}: {
  readonly onUpload: (file: File) => void;
  readonly pending: boolean;
  readonly uploading: boolean;
  readonly progress?: number | undefined;
}): JSX.Element {
  const fileInput = useRef<HTMLInputElement>(null);
  const limitId = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-10"
        disabled={uploading || pending}
        aria-describedby={limitId}
        onClick={() => fileInput.current?.click()}
      >
        {uploading ? `Uploading ${progress ?? 0}%` : 'Upload file'}
      </Button>
      <Text as="span" id={limitId} token="label-small" tone="muted">
        Up to 100 MiB
      </Text>
      <input
        ref={fileInput}
        type="file"
        aria-label="File to upload"
        tabIndex={-1}
        className="sr-only"
        disabled={uploading || pending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onUpload(file);
        }}
      />
    </div>
  );
}
