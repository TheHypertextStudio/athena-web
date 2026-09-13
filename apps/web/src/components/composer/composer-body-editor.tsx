import type { JSX } from 'react';

import { FreeformTextEditor } from '@/components/editor/freeform-text';
import type { EditorContribution } from '@/components/editor/editor-contribution';

/** Props for {@link ComposerBodyEditor}. */
export interface ComposerBodyEditorProps {
  bodyResetKey: string | number | undefined;
  body: string;
  editDisabled: boolean;
  onBodyChange: (value: string) => void;
  bodyPlaceholder: string;
  mentionOrgId: string | undefined;
  bodyContributions: readonly EditorContribution[];
  canSubmit: boolean;
  creating: boolean;
  onSubmit: () => void;
}

/** The composer's freeform description field, tinted to its own recessed surface. */
export function ComposerBodyEditor({
  bodyResetKey,
  body,
  editDisabled,
  onBodyChange,
  bodyPlaceholder,
  mentionOrgId,
  bodyContributions,
  canSubmit,
  creating,
  onSubmit,
}: ComposerBodyEditorProps): JSX.Element {
  return (
    <FreeformTextEditor
      key={bodyResetKey}
      value={body}
      disabled={editDisabled}
      onChange={onBodyChange}
      placeholder={bodyPlaceholder}
      ariaLabel={bodyPlaceholder}
      mentionOrgId={mentionOrgId}
      contributions={bodyContributions}
      onSubmit={() => {
        if (canSubmit && !creating) onSubmit();
      }}
      padding="p-3"
      className="bg-surface-container-low flex min-h-28 flex-1 flex-col overflow-y-auto overscroll-contain rounded-lg [&>div]:flex-1"
    />
  );
}
