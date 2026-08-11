import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@mui/material-nextjs/v16-appRouter', () => ({
  AppRouterCacheProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('next/font/google', () => ({
  IBM_Plex_Mono: () => ({ variable: 'font-mono' }),
  IBM_Plex_Sans: () => ({ variable: 'font-sans' }),
}));

vi.mock('@/components/providers', () => ({
  Providers: ({ children }: { children: ReactNode }) => children,
}));

import RootLayout from '../../src/app/layout';

describe('RootLayout', () => {
  it('uses the shell canvas token for the browser overscroll backdrop', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <main>Page</main>
      </RootLayout>,
    );

    expect(html).toContain('<body class="bg-surface-container">');
  });
});
