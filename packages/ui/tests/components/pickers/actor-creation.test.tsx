import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ActorPicker } from '../../../src/components/pickers/ActorPicker';

function CreationPicker({ onCreate }: { onCreate: (name: string) => void }) {
  const [query, setQuery] = useState('');
  const [name, setName] = useState<string | null>(null);
  return (
    <ActorPicker
      options={[]}
      value={null}
      onChange={vi.fn()}
      query={query}
      onQueryChange={setQuery}
      create={{
        preserveQuery: true,
        canCreate: () => true,
        render: (value) => `Add “${value}”`,
        onCreate: setName,
      }}
      confirmation={
        name ? (
          <button
            type="button"
            onClick={() => {
              onCreate(name);
            }}
          >
            Confirm {name}
          </button>
        ) : null
      }
      onCancelConfirmation={() => {
        setName(null);
      }}
    />
  );
}

describe('actor inline creation', () => {
  it('requires explicit confirmation and preserves the name when Escape returns to search', () => {
    const onCreate = vi.fn();
    render(<CreationPicker onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: /Assignee/ }));
    fireEvent.change(screen.getByPlaceholderText('Search people…'), {
      target: { value: 'Sam Rivera' },
    });
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add “Sam Rivera”' }));
    expect(screen.getByRole('button', { name: 'Confirm Sam Rivera' })).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Confirm Sam Rivera' }), {
      key: 'Escape',
    });
    expect(screen.getByPlaceholderText('Search people…')).toHaveValue('Sam Rivera');
    fireEvent.click(screen.getByRole('button', { name: 'Add “Sam Rivera”' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Sam Rivera' }));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith('Sam Rivera');
  });
  it('opens confirmation from the keyboard without submitting the surrounding form', () => {
    const submit = vi.fn();
    const create = vi.fn();
    render(
      <form onSubmit={submit}>
        <CreationPicker onCreate={create} />
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Assignee/ }));
    const search = screen.getByPlaceholderText('Search people…');
    fireEvent.change(search, { target: { value: 'Sam Rivera' } });
    fireEvent.keyDown(search, { key: 'End' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Confirm Sam Rivera' })).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
