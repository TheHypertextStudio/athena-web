import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ActorAvatar, type ActorKind } from '../../../src/components/atoms/ActorAvatar';
import { EmptyState } from '../../../src/components/atoms/EmptyState';
import { IdentityGlyph } from '../../../src/components/atoms/IdentityGlyph';
import {
  StatusGlyph,
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

describe('IdentityGlyph', () => {
  it('renders its content in a tonal circle sized to the default 40px identity scale', () => {
    render(
      <IdentityGlyph>
        <span data-testid="inner">x</span>
      </IdentityGlyph>,
    );
    const glyph = screen.getByTestId('inner').parentElement;
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph).toHaveClass('bg-surface-container-highest', 'rounded-full');
    expect(glyph).toHaveStyle({ width: '40px', height: '40px' });
  });

  it('accepts a custom size and merges an extra className', () => {
    render(
      <IdentityGlyph size={24} className="bg-primary/12">
        <span data-testid="inner2">x</span>
      </IdentityGlyph>,
    );
    const glyph = screen.getByTestId('inner2').parentElement;
    expect(glyph).toHaveStyle({ width: '24px', height: '24px' });
    expect(glyph).toHaveClass('bg-primary/12');
  });
});

describe('StatusGlyph', () => {
  it('renders a state-tinted identity circle around the ring/check/x glyph', () => {
    // The outer IdentityGlyph is `aria-hidden`, so its descendants must be queried explicitly.
    render(<StatusGlyph type="completed" label="Done" />);
    const icon = screen.getByRole('img', { hidden: true, name: 'Done' });
    expect(icon).toHaveClass('text-state-completed');
    // The wrapping IdentityGlyph carries the tonal circle fill for the same state.
    const circle = icon.parentElement;
    expect(circle).toHaveClass('bg-state-completed/15', 'text-state-completed');
    expect(circle).toHaveStyle({ width: '40px', height: '40px' });
  });

  it('scales the inner glyph from the circle size, floored at 16px', () => {
    render(<StatusGlyph type="started" size={20} />);
    const icon = screen.getByRole('img', { hidden: true, name: 'started' });
    // Math.max(16, Math.round(20 * 0.45)) === 16.
    expect(icon).toHaveStyle({ '--status-icon-size': '16px' });
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

describe('EmptyState', () => {
  it('renders the title and body with a default neutral glyph disc when no icon is given', () => {
    const { container } = render(<EmptyState title="Nothing yet" body="It will show up here." />);
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    expect(screen.getByText('It will show up here.')).toBeInTheDocument();
    // The default glyph still renders (so an omitted icon reads as intentional).
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass(
      'bg-surface-container-high',
    );
  });

  it('renders a primary action button from the cta and fires its onClick', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No projects yet"
        body="Create one to get started."
        cta={{ label: 'Create your first project', onClick }}
      />,
    );
    const button = screen.getByRole('button', { name: 'Create your first project' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('tints the glyph disc for a positive tone', () => {
    const { container } = render(
      <EmptyState tone="positive" title="Inbox zero" body="Nothing needs you." />,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass('text-state-completed');
  });

  it('renders a custom action node and merges a className override', () => {
    render(
      <EmptyState
        title="Framed"
        body="Already inside a bordered panel."
        className="border-none"
        action={<a href="/learn">Learn more</a>}
      />,
    );
    expect(screen.getByRole('link', { name: 'Learn more' })).toBeInTheDocument();
    expect(screen.getByText('Framed').parentElement).toHaveClass('border-none');
  });
});
