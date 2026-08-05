/**
 * `pnpm --filter @docket/brand icons:web` — write the browser favicon and refresh the copy of the
 * mark inlined into the offline page.
 *
 * @remarks
 * Next serves `src/app/icon.svg` at `/icon.svg` and injects the `<link rel="icon">` for it. The
 * offline page gets the same document inlined, because it is the page shown when fetching anything
 * is what failed and so cannot request the favicon.
 *
 * @see {@link file://./render-pwa.ts} for the installed Android/Chrome icons.
 * @see {@link file://./render-apple.ts} for the Apple set.
 */
import { readFile, writeFile } from 'node:fs/promises';

import { withRegeneratedMark } from './offline';
import { OFFLINE_PAGE, WEB_ICON } from './paths';
import { faviconSvg } from './svg';

async function main(): Promise<void> {
  await writeFile(WEB_ICON, faviconSvg());
  process.stdout.write('apps/web/src/app/icon.svg\n');

  const html = await readFile(OFFLINE_PAGE, 'utf8');
  await writeFile(OFFLINE_PAGE, withRegeneratedMark(html));
  process.stdout.write('apps/web/public/offline.html — inline mark\n');
}

await main();
