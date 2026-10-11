import { afterEach, describe, expect, it, vi } from 'vitest';

import { docsSiteOrigin } from '../../src/lib/docs-site';

afterEach(() => vi.unstubAllEnvs());

describe('Mintlify upstream origin', () => {
  it('retains the observed upstream without a trailing slash', () => {
    vi.stubEnv('DOCS_MINTLIFY_ORIGIN', 'https://docket.mintlify.dev/');
    expect(docsSiteOrigin()).toBe('https://docket.mintlify.dev');
  });

  it.each([
    'https://clearthedocket.com',
    'https://clearthedocket.com/docs',
    'https://user:password@docket.mintlify.dev',
    'https://docket.mintlify.dev/docs',
    'https://docket.mintlify.dev?redirect=other',
    'file:///tmp/docs',
    'not a URL',
  ])('rejects recursive or non-origin upstream %s', (origin) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://clearthedocket.com');
    vi.stubEnv('DOCS_MINTLIFY_ORIGIN', origin);
    expect(() => docsSiteOrigin()).toThrow('DOCS_MINTLIFY_ORIGIN');
  });

  it('permits an explicit local synthetic upstream for isolated acceptance', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://127.0.0.1:8787');
    vi.stubEnv('DOCS_MINTLIFY_ORIGIN', 'http://127.0.0.1:8788');
    expect(docsSiteOrigin()).toBe('http://127.0.0.1:8788');
  });
});
