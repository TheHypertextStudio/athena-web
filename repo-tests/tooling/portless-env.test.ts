import { describe, expect, it } from 'vitest';

import { portlessPrefix } from '../../scripts/portless-env';

describe('portless environment host parsing', () => {
  it.each([
    ['https://docket.localhost', 'docket'],
    ['https://api.docket.localhost', 'api.docket'],
    ['https://admin.docket.localhost', 'admin.docket'],
  ])('does not treat the canonical %s service host as a branch prefix', (url, serviceName) => {
    expect(portlessPrefix(url, serviceName)).toBeUndefined();
  });

  it.each([
    ['https://finder.docket.localhost', 'docket'],
    ['https://finder.api.docket.localhost', 'api.docket'],
    ['https://finder.admin.docket.localhost', 'admin.docket'],
  ])('extracts the branch prefix from %s', (url, serviceName) => {
    expect(portlessPrefix(url, serviceName)).toBe('finder');
  });
});
