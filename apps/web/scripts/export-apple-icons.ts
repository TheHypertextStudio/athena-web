/**
 * `pnpm --filter @docket/web exec tsx scripts/export-apple-icons.ts` — export the Apple home-screen
 * icon set from {@link file://../design/Docket.icon} using Apple's own Icon Composer renderer.
 *
 * @remarks
 * **This script renders nothing itself.** It shells out to `ictool`, the command-line exporter that
 * ships inside `Icon Composer.app` (Xcode 26), and that tool is what rasterizes the committed
 * `.icon` document. The Liquid Glass treatment — the specular edge highlight on each bar, the
 * refraction-tinted shadow, the platform mask — is produced by Apple's `IconRendering` framework,
 * not by anything in this repository. There is no way to reproduce it with `sharp`, which is
 * precisely why the source of truth for the Apple assets is a `.icon` document rather than the
 * flat `icon.svg` the Android/`any` icons are rendered from.
 *
 * **Why the Apple set is generated separately from `generate-pwa-icons.ts`.** The two must not share
 * a source or an output directory. `generate-pwa-icons.ts` owns `public/icons/*` — the manifest's
 * `any` and `maskable` entries, which Android and Chrome read — and this script owns
 * `src/app/apple-icon*.png`, which only Safari reads. Keeping them apart is what makes "adding the
 * Apple icons must not alter icons on other platforms" true by construction rather than by
 * inspection: neither script can write the other's files, and the manifest names no Apple asset at
 * all.
 *
 * **The outputs are committed, not built on demand.** `ictool` exists only on a Mac with Xcode 26
 * installed; the production build runs in a Linux container. Committing the PNGs keeps the artwork
 * reviewable in a diff and keeps installability independent of the build host, exactly as the
 * Android icons already are. Re-run this script (on a Mac) whenever `design/Docket.icon` changes.
 *
 * **Sizes.** Safari picks the `apple-touch-icon` whose declared size best matches the device, and
 * Next's `apple-icon<n>.png` file convention emits one `<link rel="apple-touch-icon" sizes="…">` per
 * numbered file with the size read from the image itself. 120/152/167/180 are the four sizes iOS
 * and iPadOS actually request; 1024 is the App Store / macOS master and is exported for review and
 * for the geometry check in `tests/pwa/apple-icon-geometry.test.ts`, which reads it rather than
 * trusting a number written down here.
 *
 * @see {@link file://../design/Docket.icon/icon.json} — the Icon Composer source document.
 * @see {@link file://./generate-pwa-icons.ts} — the untouched Android/`any` icon generator.
 */
import { execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import sharp from 'sharp';

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..');

/**
 * The Icon Composer command-line exporter.
 *
 * @remarks
 * Lives inside the app bundle rather than on `PATH`: `xcrun --find icon-composer` does not resolve
 * it, so the bundle path is the only reliable way to reach it. Absent this binary the script
 * refuses to run rather than silently falling back to a hand-rolled render — a fallback would
 * quietly replace an Apple-rendered asset with an approximation of one.
 */
const ICTOOL =
  '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool';

/** The committed Icon Composer document that every Apple asset is exported from. */
export const ICON_DOCUMENT = join(WEB_ROOT, 'design/Docket.icon');

/** One exported Apple asset. */
export interface AppleIconExport {
  /** Path to write, relative to the web app root. */
  readonly outPath: string;
  /** Output edge length in pixels (Apple icons are always square). */
  readonly size: number;
  /** Which platform mask and material Icon Composer should render with. */
  readonly platform: 'iOS' | 'macOS';
}

/**
 * The Apple asset set, in the order Next numbers them.
 *
 * @remarks
 * Exported so `tests/pwa/apple-icon-geometry.test.ts` can assert against the same list the script
 * writes, instead of restating the filenames and drifting from them.
 */
export const APPLE_ICONS: readonly AppleIconExport[] = [
  { outPath: 'src/app/apple-icon0.png', size: 120, platform: 'iOS' },
  { outPath: 'src/app/apple-icon1.png', size: 152, platform: 'iOS' },
  { outPath: 'src/app/apple-icon2.png', size: 167, platform: 'iOS' },
  { outPath: 'src/app/apple-icon3.png', size: 180, platform: 'iOS' },
  // The master. Not served: it is the reviewable full-resolution render and the input to the
  // geometry test, which measures live-area coverage and mask clearance on real pixels. Only the
  // iOS rendition is committed — at 1024 the macOS Default rendition exports byte-for-byte the
  // same image (macOS 26 adopted the same rounded-rect grid), so a second copy would be a
  // duplicate binary in the repository rather than evidence of anything.
  { outPath: 'design/exports/apple-icon-1024.png', size: 1024, platform: 'iOS' },
];

/** Whether Icon Composer's exporter is present on this machine. */
export async function ictoolAvailable(): Promise<boolean> {
  try {
    await access(ICTOOL);
    return true;
  } catch {
    return false;
  }
}

/**
 * Export one asset by invoking Icon Composer's renderer.
 *
 * @remarks
 * `ictool` writes 16-bit-per-channel RGBA, which costs ~8x the bytes of the 8-bit image every
 * browser and every Apple platform actually displays — 110 kB for a 180px icon, 2.2 MB for the
 * 1024px master. The second pass re-encodes those exact pixels at 8 bits and nothing else: no
 * resize, no recolour, no compositing, no mask. The artwork is still Icon Composer's render; only
 * the container is normalized. Doing it here rather than by hand is what keeps the committed PNGs
 * reproducible from the `.icon` document by re-running one command.
 *
 * @param spec - What to render and where to put it.
 * @returns The absolute path written and the byte length committed.
 */
async function exportIcon(spec: AppleIconExport): Promise<{ target: string; bytes: number }> {
  const target = join(WEB_ROOT, spec.outPath);
  await mkdir(dirname(target), { recursive: true });
  await execFileAsync(ICTOOL, [
    ICON_DOCUMENT,
    '--export-image',
    '--output-file',
    target,
    '--platform',
    spec.platform,
    '--rendition',
    'Default',
    '--width',
    String(spec.size),
    '--height',
    String(spec.size),
    '--scale',
    '1',
  ]);
  const normalized = await sharp(target).png({ compressionLevel: 9, effort: 10 }).toBuffer();
  await writeFile(target, normalized);
  return { target, bytes: normalized.byteLength };
}

async function main(): Promise<void> {
  if (!(await ictoolAvailable())) {
    process.stderr.write(
      'Icon Composer is not installed on this machine, so the Apple icons cannot be re-exported.\n' +
        'Install Xcode 26 or newer and run this script again. The committed PNGs are unchanged.\n',
    );
    process.exitCode = 1;
    return;
  }
  for (const spec of APPLE_ICONS) {
    const { bytes } = await exportIcon(spec);
    process.stdout.write(
      `${spec.outPath} — ${String(spec.size)}px, ${spec.platform}, ${String(bytes)} bytes\n`,
    );
  }
}

await main();
