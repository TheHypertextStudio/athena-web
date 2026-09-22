/** A {@link TaskRelationWrites} whose every write is an observable mock, for component tests. */
import { vi } from 'vitest';

import type { TaskRelationWrites } from '../../src/lib/use-task-relations';

/** Relationship writes that record their calls and change nothing. */
export interface StubRelations extends TaskRelationWrites {
  readonly link: ReturnType<typeof vi.fn<TaskRelationWrites['link']>>;
  readonly unlink: ReturnType<typeof vi.fn<TaskRelationWrites['unlink']>>;
  readonly rename: ReturnType<typeof vi.fn<TaskRelationWrites['rename']>>;
}

/**
 * Build relationship writes for a component under test; hand them to `TaskRelationsProvider`.
 *
 * @returns writes whose calls a test can assert on.
 */
export function stubRelations(): StubRelations {
  return {
    link: vi.fn<TaskRelationWrites['link']>(),
    unlink: vi.fn<TaskRelationWrites['unlink']>(),
    rename: vi.fn<TaskRelationWrites['rename']>(),
  };
}
