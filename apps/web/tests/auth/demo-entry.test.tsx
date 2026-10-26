import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('../../src/app/(auth)/_lib/server-entry-guard', () => ({
  redirectAuthenticatedVisitor: redirect,
}));
vi.mock('../../src/app/(auth)/sign-in/sign-in-client', () => ({ SignInClient: () => null }));
import SignInPage, { generateMetadata } from '../../src/app/(auth)/sign-in/page';

beforeEach(() => {
  redirect.mockReset();
});
describe('demo entry', () => {
  it('keeps normal sign-in on the existing authenticated-visitor guard', async () => {
    const page = await SignInPage({ searchParams: Promise.resolve({}) });
    expect(page.props.demoMode).toBe(false);
    expect(redirect).toHaveBeenCalledOnce();
  });
  it.each(['openai-review', 'missing', ''])(
    'handles every supplied demo link before ordinary redirects: %s',
    async (demo) => {
      const page = await SignInPage({ searchParams: Promise.resolve({ demo }) });
      expect(page.props.demoMode).toBe(true);
      expect(redirect).not.toHaveBeenCalled();
    },
  );
  it('does not index demo links or include a referrer', async () => {
    expect(
      await generateMetadata({ searchParams: Promise.resolve({ demo: 'openai-review' }) }),
    ).toEqual({ robots: { index: false, follow: false }, referrer: 'no-referrer' });
    expect(await generateMetadata({ searchParams: Promise.resolve({}) })).toEqual({});
  });
});
