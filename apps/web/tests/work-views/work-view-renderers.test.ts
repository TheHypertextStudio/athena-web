import { describe, expect, it } from 'vitest';

import {
  supportsWorkViewRenderer,
  workViewRendererLayouts,
} from '../../src/components/work-views/work-view-renderers';
import { formatWorkViewValue } from '../../src/components/work-views/renderer-types';

describe('work-view renderer registry', () => {
  it('keeps reusable renderer choices out of object field contracts', () => {
    expect(workViewRendererLayouts('program')).toEqual(['list', 'board', 'cards']);
    expect(workViewRendererLayouts('initiative')).toEqual(['list', 'board', 'cards', 'timeline']);
    expect(supportsWorkViewRenderer('program', 'timeline')).toBe(false);
  });

  it('renders a semantic timeframe label in every shared roster renderer', () => {
    expect(formatWorkViewValue({ key: '2027-06-30|halfYear|6', label: 'H2 FY 2027' }, 'enum')).toBe(
      'H2 FY 2027',
    );
  });
});
