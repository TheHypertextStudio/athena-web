import '@testing-library/jest-dom/vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AppShell } from '../../../src/components/shell/AppShell';
import { ContextProvider } from '../../../src/components/shell/ContextProvider';

it('keeps mobile launchers unavailable until their handlers hydrate, then opens Agenda on the first activation', async () => {
  const content = (
    <ContextProvider initialContext={null}>
      <AppShell
        sidebar={<nav>Navigation</nav>}
        aside={{
          panels: [
            { id: 'agenda', label: 'Agenda', icon: <span />, node: <p>Calendar entries</p> },
          ],
          defaultPanelId: 'agenda',
        }}
      >
        <h1>Today</h1>
      </AppShell>
    </ContextProvider>
  );
  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | undefined;
  try {
    container.innerHTML = renderToString(content);
    const agenda = within(container).getByRole('button', { name: 'Show Agenda' });
    expect(agenda).toBeDisabled();
    expect(within(container).getByRole('button', { name: 'Open navigation' })).toBeDisabled();
    await act(async () => {
      root = hydrateRoot(container, content);
    });
    expect(agenda).toBeEnabled();
    await userEvent.click(agenda);
    expect(await screen.findByRole('dialog', { name: 'Agenda' })).toBeVisible();
  } finally {
    await act(async () => {
      root?.unmount();
    });
    container.remove();
  }
});
