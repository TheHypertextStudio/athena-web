import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EntityIconGlyph } from '../../../src/components/entity-display/entity-icon-glyph';
import { TeamCover } from '../../../src/components/teams/team-cover';

describe('EntityIconGlyph', () => {
  it('renders a symbol with the selected foreground and tinted background', () => {
    render(
      <EntityIconGlyph
        subjectType="project"
        glyph={{ kind: 'symbol', name: 'rocket_launch' }}
        colorKey="purple"
        customColor="#6d28d9"
      />,
    );

    expect(screen.getByText('rocket_launch')).toHaveStyle({ color: '#6d28d9' });
    expect(screen.getByTestId('initiative-icon-circle')).toHaveStyle({
      backgroundColor: '#6d28d926',
    });
  });

  it('keeps emoji native color while tinting only its surrounding circle', () => {
    render(
      <EntityIconGlyph
        subjectType="team"
        glyph={{ kind: 'emoji', hexcode: '1F680' }}
        colorKey="blue"
        customColor="#123456"
      />,
    );

    expect(screen.getByText('🚀')).not.toHaveStyle({ color: '#123456' });
    expect(screen.getByTestId('initiative-icon-circle')).toHaveStyle({
      backgroundColor: '#12345626',
    });
  });
});

describe('TeamCover', () => {
  it('uses the saved emoji in a generated Team cover', () => {
    render(
      <TeamCover
        teamName="Launch team"
        display={{
          subjectType: 'team',
          subjectId: 'team-1',
          glyph: { kind: 'emoji', hexcode: '1F680' },
          iconKey: 'users',
          colorKey: 'purple',
          customColor: null,
          coverImage: null,
          customized: true,
        }}
      />,
    );

    expect(screen.getByText('🚀')).toBeInTheDocument();
  });
});
