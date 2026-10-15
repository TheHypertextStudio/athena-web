import { useComposerWorkspaceReset } from '@/components/composer/use-composer-workspace-reset';
import type { ProgramDraft, ProgramGlobalCreation } from './create-program';

/** Preserve Program prose while clearing references owned by its previous workspace. */
export function useProgramWorkspaceReset(
  host: ProgramGlobalCreation | undefined,
  setError: (error: string | null) => void,
  updateDraft: (recipe: (current: ProgramDraft) => Partial<ProgramDraft>) => void,
): void {
  useComposerWorkspaceReset(
    host,
    () => {
      setError(null);
      updateDraft(() => ({
        ownerId: null,
        workTypeId: null,
        workTypeVersionId: null,
        blueprint: undefined,
      }));
    },
    false,
  );
}
