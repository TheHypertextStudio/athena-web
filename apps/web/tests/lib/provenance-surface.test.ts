import { afterEach, describe, expect, it } from 'vitest';

import { appSurfaceForPath, surfaceHeaders } from '@/lib/provenance/surface';

describe('appSurfaceForPath', () => {
  it('reads a record page as its detail surface and its index as a list', () => {
    expect(appSurfaceForPath('/orgs/org_1/tasks/task_1')).toBe('detail');
    expect(appSurfaceForPath('/orgs/org_1/projects/project_1')).toBe('detail');
    expect(appSurfaceForPath('/orgs/org_1/projects')).toBe('list');
  });

  it('maps personal and workspace destinations to their surfaces', () => {
    expect(appSurfaceForPath('/today')).toBe('home');
    expect(appSurfaceForPath('/orgs/org_1/my-work')).toBe('home');
    expect(appSurfaceForPath('/inbox')).toBe('inbox');
    expect(appSurfaceForPath('/orgs/org_1/triage')).toBe('inbox');
    expect(appSurfaceForPath('/calendar')).toBe('calendar');
    expect(appSurfaceForPath('/orgs/org_1/graph')).toBe('canvas');
    expect(appSurfaceForPath('/orgs/org_1/settings/members')).toBe('settings');
  });

  it('recognizes the planning canvas personally and in a workspace', () => {
    expect(appSurfaceForPath('/plan')).toBe('plan');
    expect(appSurfaceForPath('/orgs/org_1/plans/plan_1')).toBe('plan');
  });

  it('names no surface for pages work is not changed from', () => {
    expect(appSurfaceForPath('/athena')).toBeNull();
    expect(appSurfaceForPath('/orgs/org_1/people')).toBeNull();
    expect(appSurfaceForPath('/')).toBeNull();
  });
});

describe('surfaceHeaders', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('sends the surface of the current page', () => {
    window.history.replaceState(null, '', '/orgs/org_1/tasks/task_1');
    expect(surfaceHeaders()).toEqual({ 'Docket-Surface': 'detail' });
  });

  it('sends nothing from a page that is not a surface', () => {
    window.history.replaceState(null, '', '/athena');
    expect(surfaceHeaders()).toEqual({});
  });
});
