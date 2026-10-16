import type { changeSetEntry } from '@docket/db';
import type { TemplateCopyUndoCaller } from '../lib/template-gallery/undo-context';
import type { StoredEntry } from './change-set-companions';
import type { Tx } from './change-set';

/** What an Undo did to one entity, with a stable reason for retained work. */
export interface UndoOutcome {
  readonly kind: string;
  readonly id: string;
  readonly reverted: boolean;
  readonly reason?: string;
}

/** Recheck authenticated permissions; copy authority is a server adapter identity, never receipt attribution. */
export type UndoAccessCheck = ((tx: Tx, entries: readonly StoredEntry[]) => Promise<void>) & {
  readonly templateCopyCaller?: TemplateCopyUndoCaller;
};

/** Existing work-reversal callback; protected template copies do not invoke work or plan callbacks. */
export type UndoRevertedHandler = (input: {
  readonly tx: Tx;
  readonly entries: readonly (typeof changeSetEntry.$inferSelect)[];
  readonly outcomes: readonly UndoOutcome[];
}) => Promise<void>;
