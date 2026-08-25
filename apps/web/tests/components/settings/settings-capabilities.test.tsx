import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsGroup } from '@/components/settings/settings-group';
import { SETTINGS_NODES } from '@/components/settings/settings-capabilities';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Settings capability headings', () => {
  it('uses descriptor copy and a stable focusable anchor', () => {
    render(<SettingsGroup capability={SETTINGS_NODES.securityPasskeys}>Content</SettingsGroup>);

    const heading = screen.getByRole('heading', { name: 'Passkeys' });
    expect(heading).toHaveAttribute('id', 'settings-passkeys');
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText(SETTINGS_NODES.securityPasskeys.description)).toBeInTheDocument();
  });
});
