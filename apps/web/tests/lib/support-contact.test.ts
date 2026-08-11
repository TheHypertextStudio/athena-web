import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  NEXT_PUBLIC_APP_URL: 'https://docket.hypertext.studio',
  NEXT_PUBLIC_PASSKEY_RP_ID: 'hypertext.studio',
  NEXT_PUBLIC_ROOT_DOMAIN: undefined as string | undefined,
  NEXT_PUBLIC_SUPPORT_EMAIL: undefined as string | undefined,
}));

vi.mock('@docket/env/web', () => ({ env: runtime }));

describe('public support contact', () => {
  beforeEach(() => {
    runtime.NEXT_PUBLIC_APP_URL = 'https://docket.hypertext.studio';
    runtime.NEXT_PUBLIC_PASSKEY_RP_ID = 'hypertext.studio';
    runtime.NEXT_PUBLIC_ROOT_DOMAIN = undefined;
    runtime.NEXT_PUBLIC_SUPPORT_EMAIL = undefined;
    vi.resetModules();
  });

  it('uses the configured support mailbox when one is provided', async () => {
    runtime.NEXT_PUBLIC_SUPPORT_EMAIL = 'help@example.com';

    const { SUPPORT_EMAIL } = await import('@/lib/support-contact');

    expect(SUPPORT_EMAIL).toBe('help@example.com');
  });

  it('derives the mailbox from the explicit public root domain', async () => {
    runtime.NEXT_PUBLIC_ROOT_DOMAIN = 'docket.place';

    const { SUPPORT_EMAIL } = await import('@/lib/support-contact');

    expect(SUPPORT_EMAIL).toBe('support@docket.place');
  });

  it('uses the registrable passkey domain instead of the web subdomain', async () => {
    const { SUPPORT_EMAIL } = await import('@/lib/support-contact');

    expect(SUPPORT_EMAIL).toBe('support@hypertext.studio');
  });
});
