import '../work-template-authoring-fixture';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { WorkTemplateForm } from '@/components/templates/work-template-authoring';
it('names the actual work and its use before shape, with draft privacy separate from its icon', () => {
  render(<WorkTemplateForm orgId="org" initial={null} onCreated={vi.fn()} />);
  const name = screen.getByRole('textbox', { name: 'Template name' });
  const use = screen.getByRole('textbox', { name: 'When to use it' });
  const kind = screen.getByRole('combobox', { name: 'Kind of work' });
  expect(name.compareDocumentPosition(kind) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(use.compareDocumentPosition(kind) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Draft visible to' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Draft privacy · Only you' }));
  expect(screen.getByRole('combobox', { name: 'Draft visible to' })).toHaveValue('personal');
  expect(
    screen.queryByRole('button', { name: 'Icon and draft visibility' }),
  ).not.toBeInTheDocument();
  fireEvent.change(name, { target: { value: 'Community dinner' } });
  fireEvent.change(use, { target: { value: 'Gather neighbors and organize preparation' } });
  fireEvent.click(screen.getByRole('button', { name: 'Icon' }));
  expect(name).toHaveValue('Community dinner');
  expect(use).toHaveValue('Gather neighbors and organize preparation');
});
