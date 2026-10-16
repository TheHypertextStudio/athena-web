import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateDefinitionNavigation } from '@/components/templates/template-definition-navigation';
import { useTemplateSectionNavigation } from '@/components/templates/use-template-section-navigation';

vi.mock('@/lib/app-location', () => ({
  shellScrollPosition: () => ({ top: 0, left: 0 }),
  restoreShellScroll: vi.fn(),
}));

function NavigationHarness() {
  const navigation = useTemplateSectionNavigation('purpose');
  return (
    <>
      <TemplateDefinitionNavigation
        section={navigation.section}
        onValueChange={navigation.selectSection}
      />
      {(['purpose', 'work', 'structure', 'review'] as const).map((section) => (
        <div
          key={section}
          id={`tabpanel-${section}`}
          hidden={navigation.section !== section}
          onFocusCapture={navigation.rememberFocus}
        >
          <h2 tabIndex={-1}>{section} decision</h2>
          <input aria-label={`${section} draft`} />
        </div>
      ))}
    </>
  );
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

describe('definition step navigation', () => {
  it('shows the current step and returns to a remembered field after choosing another decision', async () => {
    const user = userEvent.setup();
    render(<NavigationHarness />);
    const chooser = screen.getByRole('button', { name: 'Change definition step' });
    expect(chooser).toHaveTextContent('1 of 4 · Purpose');
    const draft = screen.getByLabelText('purpose draft');
    await user.type(draft, 'Keep the purpose');
    await user.click(chooser);
    expect(screen.getByRole('menuitemradio', { name: 'Purpose' })).toBeChecked();
    await user.click(screen.getByRole('menuitemradio', { name: 'Included work' }));
    expect(chooser).toHaveTextContent('3 of 4 · Included work');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'structure decision' })).toHaveFocus(),
    );
    await user.click(chooser);
    await user.click(screen.getByRole('menuitemradio', { name: 'Purpose' }));
    await waitFor(() => expect(draft).toHaveFocus());
    expect(draft).toHaveValue('Keep the purpose');
  });

  it('opens with the keyboard and returns to the chooser when dismissed without changing steps', async () => {
    const user = userEvent.setup();
    render(<NavigationHarness />);
    const chooser = screen.getByRole('button', { name: 'Change definition step' });
    chooser.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menuitemradio', { name: 'Review' });
    await user.keyboard('{End}{Enter}');
    expect(chooser).toHaveTextContent('4 of 4 · Review');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'review decision' })).toHaveFocus(),
    );
    chooser.focus();
    await user.keyboard('{Enter}{Escape}');
    await waitFor(() => expect(chooser).toHaveFocus());
    expect(chooser).toHaveTextContent('4 of 4 · Review');
  });
});
