import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ActorAvatar } from '../../../src/components/atoms/ActorAvatar';
import { DecorativeIcon } from '../../../src/primitives/decorative-icon';

afterEach(cleanup);
describe('identity artwork fallback', () => {
  it('retains an agent name and caller-provided fallback when no image is available', () => {
    render(
      <ActorAvatar
        kind="agent"
        name="Build agent"
        fallback={<span>Agent artwork unavailable</span>}
      />,
    );
    expect(screen.getByRole('img', { name: 'Build agent' })).toBeVisible();
    expect(screen.getByText('Agent artwork unavailable')).toBeVisible();
    expect(screen.queryByText('BA')).not.toBeInTheDocument();
  });
  it('preserves human initials by default and keeps inline annotation icons out of the accessible name', () => {
    render(
      <>
        <ActorAvatar kind="human" name="Grace Hopper" />
        <p>
          <DecorativeIcon variant="inline">
            <svg role="img" aria-label="Decorative glyph" />
          </DecorativeIcon>
          Description
        </p>
      </>,
    );
    expect(screen.getByLabelText('Grace Hopper')).toBeVisible();
    expect(screen.getByText('GH')).toBeVisible();
    expect(screen.getByText('Description')).toBeVisible();
    expect(screen.queryByRole('img', { name: 'Decorative glyph' })).not.toBeInTheDocument();
  });
});
