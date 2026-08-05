/**
 * `pnpm --filter @docket/brand icons:apple:layer` — write the mark layer inside the Icon Composer
 * document.
 *
 * @remarks
 * Deliberately separate from {@link file://./render-apple.ts}, which contains no artwork
 * generation of any kind so that "the shipped Apple assets are Apple's render, not ours" stays
 * true by construction rather than by inspection. This script authors the layer; that one only
 * asks `ictool` to rasterize the document the layer belongs to.
 *
 * **Running this invalidates the exported PNGs.** The order is: run this, open
 * `design/Docket.icon` in Icon Composer to review the appearances, then run `icons:apple`.
 *
 * The layer carries no plate. Apple's is the gradient declared in `icon.json`, and its material —
 * the specular edge, the refraction-tinted shadow — is applied by `IconRendering` around whatever
 * this file draws.
 *
 * @see {@link file://../../../docs/design/brand-mark.md} for why the Apple coverage differs from
 * the web canvas.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { APPLE_CANVAS, APPLE_COVERAGE } from './mark';
import { APPLE_LAYER } from './paths';
import { bareMarkSvg } from './svg';

async function main(): Promise<void> {
  await mkdir(dirname(APPLE_LAYER), { recursive: true });
  await writeFile(APPLE_LAYER, bareMarkSvg(APPLE_CANVAS, APPLE_COVERAGE));
  process.stdout.write(
    'apps/web/design/Docket.icon/Assets/Bars.svg\n' +
      'Open design/Docket.icon in Icon Composer, then run `icons:apple` to export.\n',
  );
}

await main();
