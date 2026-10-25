import { expect, it } from 'vitest';
import { shellCacheKey } from '../src/worker/documents';
it('separates each focused work-definition activity and the actual signed-in account', () => {
  const root = '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAV/work-templates',
    origin = 'https://docket.local';
  const paths = [
    '/today',
    `${root}/new`,
    `${root}/gallery`,
    `${root}/review/proposal`,
    `${root}/copy/attempt`,
    `${root}/convert-labels`,
    `${root}/suggest-from-labels`,
  ];
  const keys = paths.map((path) => shellCacheKey(origin, 'person', path));
  expect(new Set(keys).size).toBe(paths.length);
  for (const path of paths)
    expect(shellCacheKey(origin, 'person', path)).not.toBe(shellCacheKey(origin, 'other', path));
});
