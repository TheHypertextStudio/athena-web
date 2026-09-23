/**
 * Roster number cells: progress as a bar and percentage, the time estimate as `h:mm`, and `null`
 * for fields each renderer does not own.
 */
import '@testing-library/jest-dom/vitest';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  renderEstimatePropertyValue,
  renderProgressPropertyValue,
} from '../../src/components/work-views/work-list-number-values';

describe('renderEstimatePropertyValue', () => {
  it('renders a time estimate as h:mm', () => {
    const cell = renderEstimatePropertyValue({ fieldKey: 'estimateMinutes', value: 90 });
    expect(render(<>{cell}</>).container).toHaveTextContent('1:30');
  });

  it('renders a placeholder for an unset estimate', () => {
    const cell = renderEstimatePropertyValue({ fieldKey: 'estimateMinutes', value: null });
    expect(render(<>{cell}</>).container).toHaveTextContent('—');
  });

  it('leaves other fields to the next renderer', () => {
    expect(renderEstimatePropertyValue({ fieldKey: 'estimate', value: 3 })).toBeNull();
  });
});

describe('renderProgressPropertyValue', () => {
  it('renders a fraction as a percentage', () => {
    const cell = renderProgressPropertyValue({ fieldKey: 'progress', value: 0.25 });
    expect(render(<>{cell}</>).container).toHaveTextContent('25%');
  });

  it('leaves other fields to the next renderer', () => {
    expect(renderProgressPropertyValue({ fieldKey: 'estimateMinutes', value: 30 })).toBeNull();
  });
});
