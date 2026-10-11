import { loseDevice, newUser, signUp } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

test('keeps authenticated documents private across logout and a different viewer', async ({
  page,
}) => {
  const first = newUser('WorkerPrivateFirst');
  await signUp(page, first);
  const firstDocument = await page.request.get('/today');
  expect(firstDocument.status()).toBe(200);
  expect(firstDocument.headers()['cache-control']).toContain('private');
  expect(firstDocument.headers()['cache-control']).toContain('no-store');
  expect(await firstDocument.text()).toContain(first.email);
  await loseDevice(page);
  const signedOut = await page.request.get('/today', { maxRedirects: 0 });
  expect(signedOut.status()).toBe(307);
  expect(await signedOut.text()).not.toContain(first.email);

  const second = newUser('WorkerPrivateSecond');
  await signUp(page, second);
  const secondDocument = await page.request.get('/today');
  expect(secondDocument.status()).toBe(200);
  expect(secondDocument.headers()['cache-control']).toContain('private');
  expect(secondDocument.headers()['cache-control']).toContain('no-store');
  const html = await secondDocument.text();
  expect(html).toContain(second.email);
  expect(html).not.toContain(first.email);
});
