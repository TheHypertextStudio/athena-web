import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MentionTextarea from '@/components/mentions/mention-textarea';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/components/active-org', () => ({
  useActiveOrg: () => ({ orgName: () => 'Community' }),
}));
vi.mock('@/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canContribute: true }),
}));
vi.mock('@/components/people/people-queries', () => ({
  useAddPerson: () => ({ mutateAsync: mocks.create, isPending: false }),
}));
vi.mock('@/components/mentions/use-mention-search', () => ({
  useMentionSearch: () => ({
    groups: [],
    items: [],
    localPending: false,
    externalPending: false,
    localFailed: false,
    externalFailed: false,
  }),
}));

function Composer() {
  const [value, setValue] = useState('Ask @Sam Rivera about the launch.');
  return <MentionTextarea aria-label="Comment" orgId="org_1" value={value} onChange={setValue} />;
}

afterEach(() => {
  cleanup();
  mocks.create.mockReset();
});

describe('inline person mention insertion', () => {
  it('preserves surrounding prose and restores the caret after the newly created mention', async () => {
    mocks.create.mockResolvedValue({ actorId: 'person_1', displayName: 'Sam Rivera' });
    render(<Composer />);
    const field = screen.getByRole<HTMLTextAreaElement>('combobox', { name: 'Comment' });
    field.focus();
    field.setSelectionRange('Ask @Sam Rivera'.length, 'Ask @Sam Rivera'.length);
    fireEvent.click(field);
    const create = await screen.findByText('Add “Sam Rivera”');
    fireEvent.click(create);
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Add and select' }));
    await waitFor(() => {
      expect(field.value).toContain('person_1');
    });
    expect(field.value.startsWith('Ask ')).toBe(true);
    expect(field.value.endsWith(' about the launch.')).toBe(true);
    await waitFor(() => {
      expect(field.selectionStart).toBe(field.value.indexOf(' about the launch.'));
    });
    expect(field).toHaveFocus();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('never opens creation in a read-only textarea', () => {
    render(
      <MentionTextarea
        aria-label="Comment"
        orgId="org_1"
        value="Ask @Sam"
        readOnly
        onChange={vi.fn()}
      />,
    );
    const field = screen.getByRole<HTMLTextAreaElement>('combobox', { name: 'Comment' });
    field.setSelectionRange(8, 8);
    fireEvent.click(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.queryByText('Add “Sam”')).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('does not overwrite prose edited while creation is pending', async () => {
    let complete!: (person: { actorId: string; displayName: string }) => void;
    mocks.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render(<Composer />);
    const field = screen.getByRole<HTMLTextAreaElement>('combobox', { name: 'Comment' });
    field.focus();
    field.setSelectionRange(15, 15);
    fireEvent.click(field);
    fireEvent.click(await screen.findByText('Add “Sam Rivera”'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add and select' }));
    fireEvent.change(field, { target: { value: 'Keep this newer draft.' } });
    complete({ actorId: 'person_1', displayName: 'Sam Rivera' });
    await waitFor(() => {
      expect(field.value).toBe('Keep this newer draft.');
    });
    expect(field.value).not.toContain('person_1');
  });
});
