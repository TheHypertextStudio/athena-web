import { describe, expect, it } from 'vitest';

import { assertPublishingHostConfigured } from '../../src/lib/require-publishing-host';

describe('assertPublishingHostConfigured', () => {
  it('throws when building for Vercel production without NEXT_PUBLIC_BRIEF_HOST', () => {
    expect(() => {
      assertPublishingHostConfigured('production', undefined);
    }).toThrow('NEXT_PUBLIC_BRIEF_HOST is required for a production build');
  });

  it('passes when building for Vercel production with NEXT_PUBLIC_BRIEF_HOST set', () => {
    expect(() => {
      assertPublishingHostConfigured('production', 'briefs.example.com');
    }).not.toThrow();
  });

  it('does not require the host outside a production build', () => {
    expect(() => {
      assertPublishingHostConfigured('preview', undefined);
    }).not.toThrow();
    expect(() => {
      assertPublishingHostConfigured(undefined, undefined);
    }).not.toThrow();
  });
});
