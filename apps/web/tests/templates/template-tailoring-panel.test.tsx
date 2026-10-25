import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplateTailoringChoices } from '@/components/templates/gallery/template-tailoring-choices';

describe('optional saved-context tailoring', () => {
  it('keeps Free availability honest without replacing the manual gallery', () => {
    render(
      <TemplateTailoringChoices
        availability="requires_pro"
        conversations={[]}
        importedWork={[]}
        selection={{ sessionIds: [], importedTaskIds: [] }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Docket Pro/)).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it('requires a person to select actual saved context and never invents usage', () => {
    const change = vi.fn();
    render(
      <TemplateTailoringChoices
        availability="available"
        conversations={[{ id: 'conversation', label: 'Event planning conversation' }]}
        importedWork={[{ id: 'import', label: 'Volunteer welcome' }]}
        selection={{ sessionIds: [], importedTaskIds: [] }}
        onChange={change}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Event planning conversation' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Event planning conversation' }));
    expect(change).toHaveBeenCalledWith({ sessionIds: ['conversation'], importedTaskIds: [] });
    expect(screen.getByRole('checkbox', { name: 'Volunteer welcome' })).not.toBeChecked();
  });
  it('offers useful manual guidance when there is no saved source', () => {
    render(
      <TemplateTailoringChoices
        availability="available"
        conversations={[]}
        importedWork={[]}
        selection={{ sessionIds: [], importedTaskIds: [] }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/No saved conversation or imported work/)).toBeVisible();
  });
});
