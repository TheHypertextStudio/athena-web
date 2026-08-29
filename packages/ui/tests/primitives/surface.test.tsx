import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  SURFACE_TONES,
  Surface,
  surfaceToneColor,
  surfaceToneVariable,
} from '../../src/primitives/surface';

describe('Surface', () => {
  it('renders every named resting role with its semantic token and default geometry', () => {
    for (const tone of SURFACE_TONES) {
      const { unmount } = render(
        <Surface data-testid="surface" tone={tone}>
          content
        </Surface>,
      );
      const surface = screen.getByTestId('surface');
      expect(surface).toHaveAttribute('data-surface-tone', tone);
      expect(surface).toHaveClass(surfaceToneColor(tone), 'rounded-xl');
      unmount();
    }
  });

  it('supports semantic landmarks and only adds the requested inset', () => {
    render(
      <Surface as="main" pad="roomy" data-testid="main-surface" tone="page">
        content
      </Surface>,
    );
    const surface = screen.getByTestId('main-surface');
    expect(surface.tagName).toBe('MAIN');
    expect(surface).toHaveClass('p-4');
    expect(surfaceToneVariable('page')).toBe('--surface');
  });

  it('names the default card role in the rendered output', () => {
    render(<Surface data-testid="default-surface">content</Surface>);
    expect(screen.getByTestId('default-surface')).toHaveAttribute('data-surface-tone', 'card');
  });
});
