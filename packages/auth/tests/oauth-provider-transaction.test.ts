import { describe, expect, it } from 'vitest';

import { coordinatingAdapter } from '../src/oauth-provider-transaction';

describe('OAuth provider transaction coordinator', () => {
  it.each([undefined, null, false, 0, 'options'])(
    'rejects a missing provider options object: %s',
    (options) => {
      expect(() => coordinatingAdapter(options)).toThrow(
        'Better Auth endpoint context did not include provider options.',
      );
    },
  );
});
