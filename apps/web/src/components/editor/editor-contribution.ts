import type { Editor } from '@tiptap/react';
import type { ReactNode } from 'react';

import type { SlashCommand } from './slash-commands';

/** One feature that adds behavior to the shared document editor. */
export interface EditorContribution {
  /** Stable identity for React rendering and contribution replacement. */
  readonly id: string;
  /** Render an action inside an editable document that has no content. */
  readonly renderEmptyAction?: ((editor: Editor) => ReactNode) | undefined;
  /** Add feature-owned commands to the editor's shared slash-command dispatcher. */
  readonly slashCommands?: readonly SlashCommand[] | undefined;
}
