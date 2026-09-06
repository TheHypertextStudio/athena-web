'use client';

import { lazy, Suspense, type JSX, useState } from 'react';

import { EntityIconGlyph } from './entity-icon-glyph';
import type { EntityIconPickerProps } from './entity-icon-picker-loaded';

const LoadedEntityIconPicker = lazy(() => import('./entity-icon-picker-loaded'));

export type { EntityIconPickerProps } from './entity-icon-picker-loaded';

/** Render the stable identity now and load its editable catalog only after the first click. */
export function EntityIconPicker(props: EntityIconPickerProps): JSX.Element {
  const [editorRequested, setEditorRequested] = useState(false);
  const size = props.size ?? 32;
  const targetSize = Math.max(40, size);
  const glyph = (
    <EntityIconGlyph
      subjectType={props.display.subjectType}
      glyph={props.display.glyph}
      colorKey={props.display.colorKey}
      customColor={props.display.customColor}
      size={size}
    />
  );

  if (!props.editable) {
    return (
      <span
        className="flex shrink-0 items-center justify-center"
        style={{ width: targetSize, height: targetSize }}
        title={props.entityName}
      >
        {glyph}
      </span>
    );
  }

  if (!editorRequested) {
    return (
      <button
        type="button"
        className="hover:bg-surface-container-high focus-visible:ring-ring flex shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
        style={{ width: targetSize, height: targetSize }}
        aria-label={`Customize ${props.entityName} icon`}
        disabled={props.pending}
        onClick={() => {
          setEditorRequested(true);
          props.onOpenChange?.(true);
        }}
      >
        {glyph}
      </button>
    );
  }

  return (
    <Suspense
      fallback={
        <button
          type="button"
          className="flex shrink-0 items-center justify-center rounded-full"
          style={{ width: targetSize, height: targetSize }}
          aria-label={`Loading ${props.entityName} icon picker`}
          disabled
        >
          {glyph}
        </button>
      }
    >
      <LoadedEntityIconPicker {...props} initiallyOpen />
    </Suspense>
  );
}

export default EntityIconPicker;
