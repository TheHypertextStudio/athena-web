/**
 * `pnpm --filter @docket/brand icons:web` — write the browser favicon and refresh the copy of the
 * mark inlined into the offline page.
 *
 * @remarks
 * Next serves `src/app/icon.svg` at `/icon.svg` and injects the `<link rel="icon">` for it. This
 * is the only asset in the set that adapts to the OS theme; see
 * {@link file://./svg.ts | themedMarkSvg} for which browsers honour that and which do not.
 *
 * @see {@link file://./render-pwa.ts} for the installed Android/Chrome icons.
 * @see {@link file://./render-apple.ts} for the Apple set.
 */
import { readFile, writeFile } from 'node:fs/promises';

import { withRegeneratedMark } from './offline';
import { OFFLINE_PAGE, WEB_ICON } from './paths';
import { themedMarkSvg } from './svg';

async function main(): Promise<void> {
  await writeFile(WEB_ICON, themedMarkSvg());
  process.stdout.write('apps/web/src/app/icon.svg\n');

  const html = await readFile(OFFLINE_PAGE, 'utf8');
  await writeFile(OFFLINE_PAGE, withRegeneratedMark(html));
  process.stdout.write('apps/web/public/offline.html — inline mark\n');
}

await main();
