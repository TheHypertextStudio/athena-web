import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import { ImmersiveShell } from '../../../src/components/shell/ImmersiveShell';
import { PageScrollProvider, useOwnPageScroll } from '../../../src/components/shell/page-scroll';
import { useShellOverlayHost } from '../../../src/components/shell/ShellOverlayContext';

function SelfScrollingActivity() {
  useOwnPageScroll();
  const host = useShellOverlayHost();
  return <p>{host ? 'Overlay ready' : 'Waiting for overlay'}</p>;
}

describe('ImmersiveShell', () => {
  it('keeps activity content and standing notices in one full-window landmark', () => {
    render(
      <ContextProvider initialContext="workspace" initialDensity="compact">
        <ImmersiveShell banner={<p>Changes saved locally</p>}>
          <h1>Plan today</h1>
        </ImmersiveShell>
      </ContextProvider>,
    );
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading'));
    expect(screen.getByRole('main')).not.toContainElement(
      screen.getByText('Changes saved locally'),
    );
    expect(screen.getByRole('main').parentElement).toHaveAttribute('data-density', 'compact');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('gives self-scrolling activities the full main region and an overlay host', () => {
    render(
      <ContextProvider>
        <PageScrollProvider>
          <ImmersiveShell>
            <SelfScrollingActivity />
          </ImmersiveShell>
        </PageScrollProvider>
      </ContextProvider>,
    );
    expect(screen.getByText('Overlay ready')).toBeVisible();
    expect(screen.getByRole('main')).toHaveClass('overflow-hidden');
    expect(screen.getByRole('main')).not.toHaveClass('overflow-auto');
  });
});
