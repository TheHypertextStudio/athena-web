import { describe, expect, it } from 'vitest';

import { assertLocalCaptureBaseUrl } from '../../e2e/tools/capture-policy';

describe('capture screenshot host policy', () => {
  it.each([
    'http://localhost:3000',
    'https://docket.localhost',
    'http://127.0.0.1:8787',
    'http://[::1]:3000',
  ])('accepts the local capture origin %s', (baseUrl) => {
    expect(() => {
      assertLocalCaptureBaseUrl(baseUrl);
    }).not.toThrow();
  });

  it.each([
    'https://docket.hypertext.studio',
    'https://api.docket.hypertext.studio',
    'https://preview.example.com',
  ])('rejects the non-local capture origin %s', (baseUrl) => {
    expect(() => {
      assertLocalCaptureBaseUrl(baseUrl);
    }).toThrow('capture-shots refuses non-local session metadata');
  });
});
