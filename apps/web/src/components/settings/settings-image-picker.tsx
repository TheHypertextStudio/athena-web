'use client';

import { Avatar, AvatarFallback, AvatarImage, Button } from '@docket/ui/primitives';
import { useRef, useState, type ChangeEvent, type JSX } from 'react';

/** Maximum image size accepted by Settings editors. */
export const MAX_SETTINGS_IMAGE_BYTES = 1024 * 1024;

/** MIME types that browsers and Docket's avatar surfaces can render safely. */
const SETTINGS_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Return user-facing validation copy for an image file, or `null` when it is accepted. */
export function settingsImageFileError(file: Pick<File, 'size' | 'type'>): string | null {
  if (!SETTINGS_IMAGE_TYPES.has(file.type)) return 'Choose a JPG, PNG, WebP, or GIF image.';
  if (file.size > MAX_SETTINGS_IMAGE_BYTES) return 'Choose an image smaller than 1 MB.';
  if (file.size === 0) return 'That image is empty.';
  return null;
}

/** Read an accepted image into the temporary upload value sent to managed API storage. */
export function readSettingsImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Image reader returned no data.'));
    });
    reader.addEventListener('error', () => {
      reject(new Error('Image reader failed.'));
    });
    reader.readAsDataURL(file);
  });
}

/** Props for the reusable profile/workspace image editor. */
export interface SettingsImagePickerProps {
  /** Accessible field name. */
  readonly label: string;
  /** Current saved or draft image value. */
  readonly value: string;
  /** Initials or glyph shown when there is no image. */
  readonly fallback: string;
  /** Called with a selected image or an empty string when removed. */
  readonly onChange: (value: string) => void;
  /** Prevent image changes when the caller lacks permission. */
  readonly disabled?: boolean;
}

/** A normal file-picker experience for editing an image-backed Settings attribute. */
export function SettingsImagePicker({
  label,
  value,
  fallback,
  onChange,
  disabled = false,
}: SettingsImagePickerProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function chooseImage(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const validationError = settingsImageFileError(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      onChange(await readSettingsImage(file));
      setError(null);
    } catch {
      setError('Could not read that image.');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-on-surface text-sm font-medium">{label}</span>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar className="size-14">
          <AvatarImage src={value || undefined} alt="" />
          <AvatarFallback>{fallback}</AvatarFallback>
        </Avatar>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          disabled={disabled}
          aria-label={`Choose ${label.toLowerCase()}`}
          onChange={(event) => {
            void chooseImage(event);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            inputRef.current?.click();
          }}
        >
          {value ? 'Replace image' : 'Choose image'}
        </Button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              onChange('');
            }}
          >
            Remove
          </Button>
        ) : null}
      </div>
      <p className="text-on-surface-variant text-xs">JPG, PNG, WebP, or GIF. Up to 1 MB.</p>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
