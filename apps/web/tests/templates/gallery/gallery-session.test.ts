import { beforeEach, expect, it } from 'vitest';
import {
  readGalleryTabMemory,
  writeGalleryTabMemory,
} from '@/components/templates/gallery/gallery-session';
const scope = { userId: 'actual-viewer', orgId: 'actual-workspace' };
beforeEach(() => {
  window.sessionStorage.clear();
});
it('restores unsaved reviewed choices after reload without retaining canonical definition bodies', () => {
  const initial = readGalleryTabMemory(scope);
  writeGalleryTabMemory(scope, {
    ...initial,
    choices: { ...initial.choices, roots: ['event'], mode: 'published' },
    filters: { fork: 'nonprofit' },
  });
  const restored = readGalleryTabMemory(scope);
  expect(restored.choices.roots).toEqual(['event']);
  expect(restored.choices.mode).toBe('published');
  expect(restored.filters.fork).toBe('nonprofit');
  expect(JSON.stringify(window.sessionStorage)).not.toContain('definition');
  expect(readGalleryTabMemory({ ...scope, userId: 'different-viewer' }).choices.roots).toEqual([]);
  expect(readGalleryTabMemory({ ...scope, orgId: 'different-workspace' }).choices.roots).toEqual(
    [],
  );
});
it('ignores corrupt tab choices and begins with no implicit selection', () => {
  const key = `docket:gallery-review:${JSON.stringify([scope.userId, scope.orgId])}`;
  window.sessionStorage.setItem(
    key,
    JSON.stringify({ choices: { roots: ['fake/private/path'] }, filters: {} }),
  );
  expect(readGalleryTabMemory(scope).choices.roots).toEqual([]);
});
