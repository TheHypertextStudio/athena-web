/**
 * The pointer a composer leaves behind when navigation closes it mid-draft.
 *
 * @remarks
 * A create composer is closed by the global provider when the page under it changes. Its draft is
 * already on the server; what would be lost is *which* draft this tab was in the middle of. The
 * provider writes that here, in `sessionStorage` (the same tier as the open-document tabs: one
 * browser tab, one session), and the next composer of the same kind to open in this tab reads it,
 * reopens the draft, and clears the pointer. A pointer for another kind is left where it is.
 *
 * Storage can be unavailable (private windows, blocked site data) or hold something this code
 * did not write; both read as "no pointer".
 */
import { ComposerDraftKind } from '@docket/work/composer-draft-contract';

/** The `sessionStorage` key for the interrupted-composer pointer. */
export const INTERRUPTED_DRAFT_STORAGE_KEY = 'docket.composer.interrupted';

/** What the pointer holds. */
interface InterruptedDraftPointer {
  readonly kind: ComposerDraftKind;
  readonly draftId: string;
}

/** The stored pointer, or null when there is none or it is unreadable. */
function readPointer(): InterruptedDraftPointer | null {
  try {
    const raw = window.sessionStorage.getItem(INTERRUPTED_DRAFT_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { kind, draftId } = parsed as Partial<Record<'kind' | 'draftId', unknown>>;
    const kindResult = ComposerDraftKind.safeParse(kind);
    if (!kindResult.success || typeof draftId !== 'string' || draftId.length === 0) return null;
    return { kind: kindResult.data, draftId };
  } catch {
    return null;
  }
}

/**
 * Record the draft an interrupted composer was writing to.
 *
 * @param kind - The composer that was closed.
 * @param draftId - Its draft row, or null when it had not saved one, in which case there is
 * nothing to point to and any earlier pointer stands.
 */
export function writeInterruptedDraft(kind: ComposerDraftKind, draftId: string | null): void {
  if (draftId === null) return;
  try {
    const pointer: InterruptedDraftPointer = { kind, draftId };
    window.sessionStorage.setItem(INTERRUPTED_DRAFT_STORAGE_KEY, JSON.stringify(pointer));
  } catch {
    // Storage refused the write; the draft is still on the server, only the pointer is lost.
  }
}

/** The interrupted draft for this kind, left in place. */
export function peekInterruptedDraft(kind: ComposerDraftKind): string | null {
  const pointer = readPointer();
  return pointer !== null && pointer.kind === kind ? pointer.draftId : null;
}

/** Forget the pointer, when it belongs to this kind. */
export function clearInterruptedDraft(kind: ComposerDraftKind): void {
  if (peekInterruptedDraft(kind) === null) return;
  try {
    window.sessionStorage.removeItem(INTERRUPTED_DRAFT_STORAGE_KEY);
  } catch {
    // Nothing to do: a pointer that cannot be cleared is re-read once and then overwritten.
  }
}

/** The interrupted draft for this kind, cleared so it is reopened once. */
export function readInterruptedDraft(kind: ComposerDraftKind): string | null {
  const draftId = peekInterruptedDraft(kind);
  if (draftId !== null) clearInterruptedDraft(kind);
  return draftId;
}
