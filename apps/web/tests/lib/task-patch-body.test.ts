/**
 * The task-detail patch body sends exactly the fields a patch names, with `null` clearing.
 */
import { describe, expect, it } from 'vitest';

import { taskPatchBody } from '../../src/lib/task-patch-body';

describe('taskPatchBody', () => {
  it('sends only the fields the patch names', () => {
    expect(taskPatchBody({ title: 'Renamed' })).toEqual({ title: 'Renamed' });
  });

  it('sends the time estimate, and null to clear it', () => {
    expect(taskPatchBody({ estimateMinutes: 45 })).toEqual({ estimateMinutes: 45 });
    expect(taskPatchBody({ estimateMinutes: null })).toEqual({ estimateMinutes: null });
  });

  it('keeps point and time estimates separate', () => {
    expect(taskPatchBody({ estimate: 3, estimateMinutes: 90 })).toEqual({
      estimate: 3,
      estimateMinutes: 90,
    });
  });
});
