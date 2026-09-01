import {
  RESOURCE_PROVIDERS,
  ResourceProvider,
} from '@docket/connections/resource-provider-contract';
import { describe, expect, it } from 'vitest';

import { resourceProvider } from '../src/enums';

describe('resource_provider enum', () => {
  it('matches the provider registry exactly', () => {
    // Two independent declarations of the same closed set: the registry every layer reads, and the
    // column values Postgres will accept. Adding a source to one without the other is a runtime
    // insert failure, which this turns into a failing test.
    expect([...resourceProvider.enumValues].sort()).toEqual([...ResourceProvider.options].sort());
  });

  it('keeps the generic web fallback, which the registry deliberately omits', () => {
    expect(resourceProvider.enumValues).toContain('web');
    expect(RESOURCE_PROVIDERS.map((p) => p.id)).not.toContain('web');
  });
});
