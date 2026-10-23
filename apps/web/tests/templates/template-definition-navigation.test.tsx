import { TabsScope, TabPanel } from '@docket/ui/primitives';
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
    <TabsScope scope={navigation.scope}>
      <TemplateDefinitionNavigation
        section={navigation.section}
        onValueChange={navigation.selectSection}
      />
      {(['purpose', 'work', 'structure', 'review'] as const).map((section) => (
        <TabPanel
          key={section}
          value={section}
          hidden={navigation.section !== section}
          onFocusCapture={navigation.rememberFocus}
        >
          <h2 tabIndex={-1}>{section} decision</h2>
          <input aria-label={`${section} draft`} />
        </TabPanel>
      ))}
    </TabsScope>
  );
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

describe('definition section navigation', () => {
  it('shows the current step and selects every section from the phone menu', async () => {
    const user = userEvent.setup();
    render(<NavigationHarness />);
    const trigger = screen.getByRole('button', { name: 'Change definition step' });
    expect(trigger).toHaveTextContent('1 of 4 · Purpose');
    for (const [index, label] of [
      'Starting work',
      'Included work',
      'Review',
      'Purpose',
    ].entries()) {
      await user.click(trigger);
      const choices = screen.getAllByRole('menuitemradio');
      expect(choices).toHaveLength(4);
      expect(
        choices.filter((choice) => choice.getAttribute('aria-checked') === 'true'),
      ).toHaveLength(1);
      await user.click(screen.getByRole('menuitemradio', { name: label }));
      expect(trigger).toHaveTextContent(`${((index + 1) % 4) + 1} of 4 · ${label}`);
    }
  });

  it('keeps panel focus after keyboard menu selection and restores the trigger on Escape', async () => {
    const user = userEvent.setup();
    render(<NavigationHarness />);
    const draft = screen.getByLabelText('purpose draft');
    await user.type(draft, 'Keep the purpose');
    const trigger = screen.getByRole('button', { name: 'Change definition step' });
    trigger.focus();
    await user.keyboard('{Enter}{End}{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'review decision' })).toHaveFocus(),
    );
    trigger.focus();
    await user.keyboard('{Enter}{Home}{Enter}');
    await waitFor(() => expect(draft).toHaveFocus());
    expect(draft).toHaveValue('Keep the purpose');
    trigger.focus();
    await user.keyboard('{Enter}{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('returns to remembered draft input after revisiting a peer section', async () => {
    const user = userEvent.setup();
    render(<NavigationHarness />);
    const draft = screen.getByLabelText('purpose draft');
    await user.type(draft, 'Keep the purpose');
    await user.click(screen.getByRole('tab', { name: 'Included work' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'structure decision' })).toHaveFocus(),
    );
    await user.click(screen.getByRole('tab', { name: 'Purpose' }));
    await waitFor(() => expect(draft).toHaveFocus());
    expect(draft).toHaveValue('Keep the purpose');
  });
  it('keeps keyboard focus in the tablist while changing sections', async () => {
    const user = userEvent.setup();
    render(<NavigationHarness />);
    screen.getByRole('tab', { name: 'Purpose' }).focus();
    await user.keyboard('{End}');
    const review = screen.getByRole('tab', { name: 'Review' });
    expect(review).toHaveFocus();
    expect(review).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('review decision');
  });
});
