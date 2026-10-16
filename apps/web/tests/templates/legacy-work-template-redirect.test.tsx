import { StrictMode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LegacyWorkTemplateRedirect } from '@/components/templates/legacy-work-template-redirect';

const state = vi.hoisted(() => ({
  pathname: '',
  searchParams: new URLSearchParams(),
  router: { replace: vi.fn(), push: vi.fn() },
}));
vi.mock('@/lib/app-location', () => ({ useAppLocation: () => state }));
vi.mock('@/lib/interactions/navigation', () => ({ useAppRouter: () => state.router }));

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const TEMPLATE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

beforeEach(() => {
  state.pathname = `/orgs/${ORG_ID}/settings/templates/${TEMPLATE_ID}`;
  state.searchParams = new URLSearchParams('section=review&from=copy');
  state.router.replace.mockClear();
  state.router.push.mockClear();
  window.history.replaceState({}, '', `${state.pathname}?${state.searchParams}#tabpanel-review`);
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('legacy work-template reentry', () => {
  it('replaces the saved link once, preserving review and focus, without adding Settings to Back', () => {
    const mounted = render(<LegacyWorkTemplateRedirect />);
    expect(screen.getByRole('status')).toHaveTextContent('Opening Work templates');
    expect(state.router.replace).toHaveBeenCalledExactlyOnceWith(
      `/orgs/${ORG_ID}/work-templates/${TEMPLATE_ID}?section=review&from=copy#tabpanel-review`,
    );
    expect(state.router.push).not.toHaveBeenCalled();
    state.searchParams = new URLSearchParams(state.searchParams);
    mounted.rerender(<LegacyWorkTemplateRedirect />);
    expect(state.router.replace).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate replacement during strict mount replay', () => {
    render(
      <StrictMode>
        <LegacyWorkTemplateRedirect />
      </StrictMode>,
    );
    expect(state.router.replace).toHaveBeenCalledTimes(1);
    expect(state.router.push).not.toHaveBeenCalled();
  });

  it('does not navigate when mounted at an unrelated or already canonical route', () => {
    state.pathname = `/orgs/${ORG_ID}/work-templates`;
    render(<LegacyWorkTemplateRedirect />);
    expect(state.router.replace).not.toHaveBeenCalled();
    expect(state.router.push).not.toHaveBeenCalled();
  });
});
