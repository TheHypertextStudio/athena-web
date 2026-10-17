import { describe, expect, it } from 'vitest';
import { cacheClientNamespaces, parseCacheClients } from '../src/clients';

describe('canonical client namespace registry', () => {
  it('derives only identity-to-namespace bindings', () => {
    expect(
      cacheClientNamespaces([
        { subject: '123456789', namespace: 'docket' },
        { subject: '987654321', namespace: 'curfew-web' },
      ]),
    ).toEqual({ '123456789': 'docket', '987654321': 'curfew-web' });
    expect(parseCacheClients('{"123456789":"docket"}')).toEqual({ '123456789': 'docket' });
  });

  it('rejects empty or duplicate identity and namespace registries at build time', () => {
    expect(() => cacheClientNamespaces([])).toThrow();
    expect(() =>
      cacheClientNamespaces([
        { subject: '123', namespace: 'docket' },
        { subject: '123', namespace: 'curfew-web' },
      ]),
    ).toThrow();
    expect(() =>
      cacheClientNamespaces([
        { subject: '123', namespace: 'docket' },
        { subject: '456', namespace: 'docket' },
      ]),
    ).toThrow();
  });

  it.each(['', '../docket', 'Docket', 'docket/other', 'docket--other', 'a'.repeat(65)])(
    'rejects unsafe namespace %s',
    (namespace) => {
      expect(() => cacheClientNamespaces([{ subject: '123', namespace }])).toThrow();
    },
  );

  it.each(['', 'service-account@example.com', '__proto__', '123.5', '-123'])(
    'rejects a nonnumeric subject %s',
    (subject) => {
      expect(() => cacheClientNamespaces([{ subject, namespace: 'docket' }])).toThrow();
    },
  );

  it.each(['{}', '[]', 'null', 'invalid', '{"123":true}', '{"123":"docket","456":"docket"}'])(
    'rejects invalid deployed identity map %s',
    (value) => {
      expect(() => parseCacheClients(value)).toThrow();
    },
  );
});
