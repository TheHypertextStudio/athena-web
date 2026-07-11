import { describe, expect, it } from 'vitest';

import { validatedApiOrigin } from '../../src/lib/proxy-origin';

describe('validatedApiOrigin', () => {
  it('normalizes a distinct HTTPS API origin', () => {
    expect(
      validatedApiOrigin(
        'https://docket-api.hypertext.studio/path',
        'https://docket.hypertext.studio',
      ),
    ).toBe('https://docket-api.hypertext.studio');
  });

  it('rejects a recursive frontend origin', () => {
    expect(() =>
      validatedApiOrigin(
        'https://docket.hypertext.studio',
        'https://docket.hypertext.studio/sign-up',
      ),
    ).toThrow('API_URL and NEXT_PUBLIC_APP_URL must use different origins');
  });

  it('rejects invalid and non-HTTP API URLs', () => {
    expect(() => validatedApiOrigin('not a URL')).toThrow('API_URL must be an absolute URL');
    expect(() => validatedApiOrigin('file:///tmp/api')).toThrow('API_URL must use http or https');
  });
});
