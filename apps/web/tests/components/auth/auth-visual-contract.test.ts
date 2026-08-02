/**
 * Source-policy contract for the authentication surfaces.
 *
 * @remarks
 * Every rule asserted here corresponds to something that had already gone wrong: two shells
 * hardcoded the same arbitrary `oklch()` backdrop, four places inlined a `fontFamily` style that
 * bypassed the `font-display` token (and silently fell back to Georgia on the one surface whose
 * route group never published `--font-fraunces`), the auth tree carried no container context at
 * all so container-query utilities copied from app pages could never match, and the consent
 * screen's unbounded permission list pushed its own decision buttons off the viewport.
 *
 * The copy ban is here because these are utility surfaces. An auth screen that grows a tagline
 * and an explainer paragraph has become a second landing page.
 *
 * Written against files on disk rather than rendered output, following
 * `apps/web/tests/components/initiative-visual-contract.test.ts` — the same mechanism the
 * typography and touch-target contracts already use.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../../');

const layoutPath = join(root, 'packages/ui/src/components/auth/AuthLayout.tsx');
const shellPath = join(root, 'apps/web/src/app/(auth)/_components/auth-shell.tsx');
const consentPath = join(root, 'apps/web/src/app/(auth)/oauth/authorize/page.tsx');
const wordmarkPath = join(root, 'apps/web/src/components/wordmark.tsx');
const adminSignInPath = join(root, 'apps/admin/src/app/(auth)/sign-in/page.tsx');

/** Every production source file under the two auth trees. */
const AUTH_TREES = [join(root, 'apps/web/src/app/(auth)'), join(root, 'apps/admin/src/app/(auth)')];

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * A file's source with comments removed.
 *
 * @remarks
 * The bans below are on what the code *does*, and the comments explaining each ban necessarily
 * quote the pattern being banned. Scanning raw text made this file fail on its own documentation.
 */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sourcesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(path) ? [path] : [];
  });
}

/** Each auth-tree file as `relative/path\ncontents`, so a failure names the offending file. */
function authSources(): { path: string; text: string }[] {
  return AUTH_TREES.flatMap(sourcesUnder).map((path) => ({
    path: relative(root, path),
    text: code(path),
  }));
}

describe('Auth visual contract', () => {
  it('is a bounded card on the app canvas, not a full-bleed surface', () => {
    const layout = source(layoutPath);
    // Floating panel on tinted canvas — the composition the token system already documents.
    expect(layout).toContain('bg-surface-container');
    expect(layout).toContain('bg-surface');
    expect(layout).toContain('max-w-md');
    // The card widens rather than the content stacking into one narrow column on a wide viewport.
    expect(layout).toContain('@3xl:max-w-3xl');
    expect(layout).toContain('@3xl:grid-cols-');
  });

  it('carries no marketing copy', () => {
    // A sign-in screen is a utility surface. The tagline belongs on the landing page, and an
    // explainer about how passkeys work is filler in front of a single button.
    const banned = [/one calm place/i, /nothing to remember/i, /no passwords\./i];
    for (const { path, text } of authSources()) {
      for (const phrase of banned) expect(`${path}: ${text}`).not.toMatch(phrase);
    }
  });

  it('never hardcodes a color in the auth trees', () => {
    // `AuthShell` and the consent screen's since-deleted `ConsentShell` both carried
    // `bg-[oklch(0.985_0.008_85)]` — the same arbitrary value, copied.
    for (const { path, text } of authSources()) {
      expect(`${path}: ${text}`).not.toMatch(/oklch\(/);
      expect(`${path}: ${text}`).not.toMatch(/(?:bg|text|border)-\[#/);
    }
  });

  it('sizes every text node from the MD3 type scale, never a stock Tailwind size', () => {
    // SCR-11 asks that "every text node maps to an MD3 type token (no ad hoc font-size/weight)".
    // The scale lives in `packages/ui/src/styles/globals.css` as `--text-{display,headline,title,
    // body,label}-{large,medium,small}` and deliberately does NOT define Tailwind's stock
    // `text-xs … text-9xl`. Four call sites passed `text-2xl` to the wordmark (overriding its own
    // `text-3xl` default) and the sign-up screen's "Use a different email" link was `text-xs`:
    // sizes that render fine and resolve to nothing, which is exactly the drift a scale exists to
    // prevent. `text-2xl` is 1.5rem — the same as `text-headline-small` — so the tokens were
    // available the whole time.
    //
    // `Wordmark` is scanned too: it renders inside both auth trees but lives outside them, so the
    // directory walk alone would miss the size it hands every auth screen.
    const stockSize = /(?:^|["'\s])text-(?:xs|sm|base|lg|xl|[0-9]xl)(?:["'\s]|$)/m;
    for (const { path, text } of authSources().concat({
      path: relative(root, wordmarkPath),
      text: code(wordmarkPath),
    })) {
      expect(`${path}: ${text}`).not.toMatch(stockSize);
    }
  });

  it('routes the wordmark through the font-display token instead of an inline style', () => {
    for (const { path, text } of authSources()) {
      expect(`${path}: ${text}`).not.toMatch(/fontFamily/);
    }
    // The one component that owns the wordmark uses the theme token, whose own fallback stack
    // covers surfaces where no layout published `--font-fraunces`.
    expect(code(wordmarkPath)).toContain('font-display');
    expect(code(wordmarkPath)).not.toContain('fontFamily');
  });

  it('keeps the consent screen inside the (auth) route group', () => {
    // Route groups do not affect the URL, so `/oauth/authorize` is unchanged — but only inside
    // the group does the layout publish `--font-fraunces`. Outside it the wordmark rendered in
    // Georgia and nothing failed.
    expect(() => source(consentPath)).not.toThrow();
    expect(() => source(join(root, 'apps/web/src/app/oauth/authorize/page.tsx'))).toThrow();
  });

  it('declares its own container context and sizes to the dynamic viewport', () => {
    const layout = source(layoutPath);
    // Nothing upstream of the auth tree is a container: it sits outside AppShell, whose <main>
    // is the app's only container context.
    expect(layout).toContain('@container');
    expect(layout).toContain('h-dvh');
    expect(layout).not.toContain('min-h-screen');
  });

  it('responds to its container rather than the viewport', () => {
    // The repo treats a viewport prefix inside a container-query surface as a defect (see the
    // 2026-07-06 audit). The auth tree has a container of its own, so it has no excuse.
    for (const { path, text } of authSources().concat({
      path: relative(root, layoutPath),
      text: code(layoutPath),
    })) {
      expect(`${path}: ${text}`).not.toMatch(/(?:^|["'\s])(?:sm|md|lg|xl|2xl):/m);
    }
  });

  it('renders the permission list as one capped tonal block', () => {
    const consent = code(consentPath);
    // One surface for the whole grant, not a card per permission.
    expect(consent).toContain('bg-surface-container-high');
    // The server accepts arbitrary requested scopes, so the row count has no ceiling. Without the
    // cap a long list pushes the decision buttons off a short viewport — the original defect.
    expect(consent).toMatch(
      /max-h-\[\d+dvh\][^"']*overflow-y-auto|overflow-y-auto[^"']*max-h-\[\d+dvh\]/,
    );
  });

  it('makes each permission a collapsible disclosure', () => {
    const consent = code(consentPath);
    // Native <details>/<summary>: keyboard-operable and announced without a bespoke component,
    // and the repo has no Collapsible primitive to reach for.
    expect(consent).toContain('<details');
    expect(consent).toContain('<summary');
    expect(consent).toContain('group-open:rotate-180');
  });

  it('clears the 40px mobile touch-target gate on every auth action', () => {
    // The Button primitive's default is h-9 (36px), below the rubric's a11y gate, so auth
    // controls opt into `lg`.
    for (const { path, text } of authSources().concat({
      path: relative(root, adminSignInPath),
      text: code(adminSignInPath),
    })) {
      for (const match of text.matchAll(/<Button\b[^>]*>/gs)) {
        expect(`${path}: ${match[0]}`).toMatch(/size="lg"/);
      }
    }
  });

  it('composes the shared shell in both apps rather than re-deriving chrome', () => {
    for (const path of [shellPath, consentPath, adminSignInPath]) {
      expect(source(path)).toContain('AuthLayout');
    }
    // The consent screen used to hand-copy AuthShell's outer chrome into a local `ConsentShell`.
    expect(source(consentPath)).not.toContain('function ConsentShell');
  });
});
