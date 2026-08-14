import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';
import type { PickerOption } from '@docket/ui/components';
import { describe, expect, it, vi } from 'vitest';

import {
  ProjectPeopleRow,
  type ProjectAssignedPerson,
} from '../../src/components/project-detail/project-people-row';

const ownerOptions: readonly PickerOption[] = [
  { value: 'owner', label: 'Ada Lovelace' },
  { value: 'grace', label: 'Grace Hopper' },
];

const assigned: readonly ProjectAssignedPerson[] = [
  { actorId: 'owner', name: 'Ada Lovelace', kind: 'human' },
  { actorId: 'grace', name: 'Grace Hopper', kind: 'human' },
  { actorId: 'grace', name: 'Grace Hopper', kind: 'human' },
  { actorId: 'alan', name: 'Alan Turing', kind: 'human' },
  { actorId: 'agent', name: 'Research Agent', kind: 'agent' },
  { actorId: 'team', name: 'Delivery Team', kind: 'team' },
];

describe('ProjectPeopleRow', () => {
  it('renders one self-labelled owner control and a deduplicated indicator for everyone else', () => {
    render(
      <ProjectPeopleRow
        ownerId="owner"
        ownerOptions={ownerOptions}
        assignedPeople={assigned}
        canEdit
        onOwnerChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Owner', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Project owner/ })).toHaveTextContent('Ada Lovelace');
    expect(
      screen.getByLabelText(
        '4 other people assigned: Grace Hopper, Alan Turing, Research Agent, Delivery Team',
      ),
    ).toBeVisible();
    expect(screen.getByText('+1')).toBeVisible();
  });

  it('uses the empty owner prompt as the only visible ownership label', () => {
    render(
      <ProjectPeopleRow
        ownerId={null}
        ownerOptions={ownerOptions}
        assignedPeople={[]}
        canEdit
        onOwnerChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Project owner/ })).toHaveTextContent('Set owner');
    expect(screen.queryByText('Owner', { exact: true })).not.toBeInTheDocument();
  });

  it('reports an owner selection through the project mutation callback', async () => {
    const onOwnerChange = vi.fn();
    render(
      <ProjectPeopleRow
        ownerId="owner"
        ownerOptions={ownerOptions}
        assignedPeople={[]}
        canEdit
        onOwnerChange={onOwnerChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Project owner/ }));
    const option = await screen.findByRole('option', { name: 'Grace Hopper' });
    fireEvent.click(within(option).getByRole('button'));
    expect(onOwnerChange).toHaveBeenCalledExactlyOnceWith('grace');
  });
});
