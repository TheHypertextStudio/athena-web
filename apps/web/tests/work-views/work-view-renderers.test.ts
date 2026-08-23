import { describe, expect, it } from 'vitest';

import {
  supportsWorkViewRenderer,
  workViewRendererLayouts,
} from '../../src/components/work-views/work-view-renderers';

describe('work-view renderer registry', () => {
  it('keeps reusable renderer choices out of object field contracts', () => {
    expect(workViewRendererLayouts('program')).toEqual(['list', 'board', 'cards']);
    expect(workViewRendererLayouts('initiative')).toEqual(['list', 'board', 'cards', 'timeline']);
    expect(supportsWorkViewRenderer('program', 'timeline')).toBe(false);
  });
});
