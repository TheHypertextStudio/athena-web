import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ActorAvatar, type ActorKind } from '../../../src/components/atoms/ActorAvatar';
import {
  StatusIcon,
  STATE_TYPE_TOKEN_CLASS,
  type WorkflowStateType,
} from '../../../src/components/atoms/StatusIcon';

describe('StatusIcon', () => {
  const TYPES: WorkflowStateType[] = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];

  it.each(TYPES)('renders the %s type with its token class and data attribute', (type) => {
    render(<StatusIcon type={type} label={`label-${type}`} />);
    const icon = screen.getByRole('img', { name: `label-${type}` });
    expect(icon).toHaveClass(STATE_TYPE_TOKEN_CLASS[type]);
    expect(icon).toHaveAttribute('data-state-type', type);
  });

  it('falls back to the type value as the accessible label when no label is given', () => {
    render(<StatusIcon type="started" />);
    expect(screen.getByRole('img', { name: 'started' })).toBeInTheDocument();
  });

  it('merges an extra className after the token color', () => {
    render(<StatusIcon type="completed" label="done" className="custom-size" />);
    expect(screen.getByRole('img', { name: 'done' })).toHaveClass(
      'custom-size',
      'text-state-completed',
    );
  });
});

describe('ActorAvatar', () => {
  it.each<[ActorKind, string]>([
    ['human', 'rounded-full'],
    ['agent', 'rounded-lg'],
    ['team', 'rounded-md'],
  ])('renders the %s kind shape', (kind, shapeClass) => {
    render(<ActorAvatar kind={kind} name="Ada Lovelace" />);
    const box = screen.getByLabelText('Ada Lovelace');
    expect(box).toHaveClass(shapeClass);
    expect(box.parentElement).toHaveAttribute('data-actor-kind', kind);
  });

  it('renders the Sparkles badge only for the agent kind', () => {
    const { container: agentContainer } = render(<ActorAvatar kind="agent" name="Bot" />);
    expect(agentContainer.querySelector('svg')).toBeInTheDocument();

    const { container: humanContainer } = render(<ActorAvatar kind="human" name="Bob" />);
    expect(humanContainer.querySelector('svg')).not.toBeInTheDocument();
  });

  it('renders the avatar image branch when an avatarUrl is supplied', () => {
    render(<ActorAvatar kind="human" name="Carol" avatarUrl="https://example.com/c.png" />);
    // The fallback initials are present regardless of image load in jsdom.
    expect(screen.getByText('CA')).toBeInTheDocument();
  });

  it('derives two-letter initials from a multi-word name', () => {
    render(<ActorAvatar kind="human" name="Grace Hopper" />);
    expect(screen.getByText('GH')).toBeInTheDocument();
  });

  it('derives a two-char prefix from a single-word name', () => {
    render(<ActorAvatar kind="human" name="Madonna" />);
    expect(screen.getByText('MA')).toBeInTheDocument();
  });

  it('falls back to "?" for a blank name', () => {
    render(<ActorAvatar kind="human" name="   " avatarUrl={null} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('applies a custom size and merges an extra className', () => {
    render(<ActorAvatar kind="team" name="Ops" size={32} className="extra-cls" />);
    const box = screen.getByLabelText('Ops');
    expect(box).toHaveStyle({ height: '32px', width: '32px' });
    expect(box).toHaveClass('extra-cls');
  });
});
