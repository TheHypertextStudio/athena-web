/**
 * The workspace-scoped Tasks destination resolves the sidebar highlight.
 *
 * @remarks
 * `Tasks` is a top-level Workspace row, so both the roster route and a single task's detail route
 * beneath it must resolve to the same nav key — otherwise opening a task from the roster silently
 * clears the highlight of the row you arrived through. These assertions pin the resolution for the
 * whole segment table, not just the new entry, because {@link workspaceKeyFromPath} scans
 * `NAV_SEGMENTS` in order and inserting a segment is exactly the change that can shadow a
 * neighbour.
 */
import { describe, expect, it } from 'vitest';

import {
  NAV_SEGMENTS,
  isObjectDetailPath,
  workspaceKeyFromPath,
} from '@/components/app-shell-utils';

describe('workspaceKeyFromPath — the Tasks workspace destination', () => {
  it('resolves the workspace Tasks roster', () => {
    expect(workspaceKeyFromPath('/orgs/o1/tasks')).toBe('tasks');
    expect(workspaceKeyFromPath('/orgs/o1/tasks/')).toBe('tasks');
  });

  it('keeps the Tasks row highlighted on a single task detail', () => {
    expect(workspaceKeyFromPath('/orgs/o1/tasks/t1')).toBe('tasks');
  });

  it('places tasks directly after triage, matching the sidebar row order', () => {
    expect(NAV_SEGMENTS.indexOf('tasks')).toBe(NAV_SEGMENTS.indexOf('triage') + 1);
    expect(NAV_SEGMENTS.indexOf('tasks')).toBeLessThan(NAV_SEGMENTS.indexOf('stream'));
  });

  it('still resolves every other workspace segment', () => {
    for (const key of NAV_SEGMENTS) {
      expect(workspaceKeyFromPath(`/orgs/o1/${key}`)).toBe(key);
      expect(workspaceKeyFromPath(`/orgs/o1/${key}/deeper`)).toBe(key);
    }
  });

  it('does not claim the cross-org Tasks route or an unknown segment', () => {
    expect(workspaceKeyFromPath('/tasks')).toBeUndefined();
    expect(workspaceKeyFromPath('/orgs/o1')).toBeUndefined();
    expect(workspaceKeyFromPath('/orgs/o1/nowhere')).toBeUndefined();
  });

  it('still treats a single task as an object detail path, and the roster as not one', () => {
    expect(isObjectDetailPath('/orgs/o1/tasks/t1')).toBe(true);
    expect(isObjectDetailPath('/orgs/o1/tasks')).toBe(false);
  });
});
