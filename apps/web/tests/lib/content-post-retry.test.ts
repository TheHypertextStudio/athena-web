import { afterEach, describe, expect, it } from 'vitest';

import {
  clearContentPostRequestKey,
  contentPostRequestKey,
} from '../../src/lib/content-post-retry';

describe('content post retry keys', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('preserves a newer draft key when an earlier post response arrives late', async () => {
    const scope = 'org_1:project_1';
    const earlierPost = { body: 'Earlier update', attachmentIds: ['file_1'] };
    const newerDraft = { body: 'Revised update', attachmentIds: ['file_2'] };
    const earlierKey = await contentPostRequestKey(scope, earlierPost);
    const newerKey = await contentPostRequestKey(scope, newerDraft);

    await clearContentPostRequestKey(scope, earlierPost, earlierKey);

    expect(await contentPostRequestKey(scope, newerDraft)).toBe(newerKey);
  });
});
