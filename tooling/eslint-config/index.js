import { readFileSync } from 'node:fs';

import js from '@eslint/js';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

import uiOwnershipPlugin from './plugin.js';

/**
 * Shared flat ESLint config for all Docket workspace members (ESLint 9).
 *
 * Consumers import this and spread it into their own `eslint.config.js`,
 * optionally appending package-specific overrides. The preset is
 * type-checked-lint by default; packages that opt into it must point
 * `parserOptions.projectService` at their own tsconfig (done here via
 * `projectService: true`, which discovers the nearest tsconfig).
 *
 * @type {import('typescript-eslint').ConfigArray}
 */
export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Async methods that implement an async port/interface need not `await` (the
      // contract is async even when a mock is synchronous).
      '@typescript-eslint/require-await': 'off',
      // Interpolating numbers/booleans into template strings is intentional + safe.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      // TS's noPropertyAccessFromIndexSignature REQUIRES bracket access for index-signature
      // properties (TS4111); without this, the dot-notation autofix rewrites them to dot
      // access and breaks typecheck. Allow bracket access on index signatures.
      '@typescript-eslint/dot-notation': ['error', { allowIndexSignaturePropertyAccess: true }],
    },
  },
  {
    // Tests exercise `any`-typed fixture/driver values; keep the strict rules
    // everywhere else. Non-null assertions are NOT exempted here — use
    // `assertDefined` from `@docket/test-utils` instead, which throws a
    // descriptive error instead of letting `undefined` flow through silently.
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      // e2e helper glue (CDP sessions, in-page `evaluate`) is legitimately `any`-adjacent.
      '**/e2e/helpers/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      // Next.js build output is never linted. Cover backup/corrupt variants the
      // dev server can leave behind (e.g. `.next.corrupt-bak`) as well.
      '**/.next.*/**',
      '**/.turbo/**',
      '**/.wrangler/**',
      '**/coverage/**',
      // Generated build output, like `.next` above: the service worker is authored as typechecked
      // ES modules under `apps/web/service-worker` (linted there) and bundled to this file. The
      // bundle is not in any tsconfig, so the type-aware parser cannot resolve it.
      '**/public/sw.js',
      '**/drizzle/**',
      '**/.claude/**',
      '**/.lova/**',
      '**/.lova.disabled/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.config.mjs',
      '**/postcss.config.js',
      '**/next-env.d.ts',
      '**/tooling/eslint-config/**',
      '**/tooling/vitest/**',
    ],
  },
);

/**
 * Data-layer enforcement for the web app (`docs/engineering/specs/data-layer.md`).
 *
 * In `apps/web` pages and components, never hand-roll data fetching inside a `useEffect` (the
 * `useEffect` + `api.v1`/`fetch` + `setState` pattern the query layer replaces). Reads go through
 * `useApiQuery`/`useApiListQuery`/`useLiveApiQuery`; writes through `useApiMutation`
 * (`apps/web/src/lib/query.ts`). Enforced as ERROR (data-layer plan, Phase 6) so no new
 * fetch-in-effect can merge.
 *
 * Deliberately scoped to the fetch-in-effect anti-pattern: a blanket `api.v1`/`fetch` ban is
 * deferred to Phase 6, because today the toolkit legitimately calls `api.v1` inside
 * `apiQueryOptions` within page/component files, and the only bare `fetch` calls are auth/OAuth
 * flows (passkey intent, consent) that are not query-layer concerns. The ban broadens once query
 * definitions are relocated into `lib/**` / `*.query.ts` data modules.
 *
 * @type {import('typescript-eslint').ConfigArray}
 */
// The authed product app only — the `(app)` route group plus product components. Auth/OAuth/
// onboarding flows (`(auth)`, `oauth`, `onboarding`) legitimately `fetch` in effects (passkey
// ceremonies, consent) and are not product-data surfaces, so they are intentionally out of scope.
const DATA_LAYER_SURFACES = [
  'apps/web/src/app/(app)/**/*.{ts,tsx}',
  'apps/web/src/components/**/*.{ts,tsx}',
];

/** esquery selectors for the fetch-in-effect anti-pattern, with their guidance messages. */
const SPEC_REF = 'See docs/engineering/specs/data-layer.md.';
const fetchInEffectRules = [
  {
    selector:
      "CallExpression[callee.name='useEffect'] MemberExpression[object.name='api'][property.name='v1']",
    message: `Do not fetch with \`api.v1.*\` inside a useEffect — read through useApiQuery/useApiListQuery/useLiveApiQuery and write through useApiMutation (apps/web/src/lib/query.ts). ${SPEC_REF}`,
  },
  {
    selector: "CallExpression[callee.name='useEffect'] CallExpression[callee.name='fetch']",
    message: `Do not \`fetch\` inside a useEffect — go through the typed query layer (apps/web/src/lib/query.ts). ${SPEC_REF}`,
  },
];

export const dataLayerConfig = [
  {
    files: DATA_LAYER_SURFACES,
    rules: {
      'no-restricted-syntax': ['error', ...fetchInEffectRules],
    },
  },
];

/**
 * Location enforcement for the web app (`docs/engineering/specs/offline.md`).
 *
 * Inside the authenticated app, the URL is read through `apps/web/src/lib/app-location.tsx`, never
 * through Next's router. Offline the service worker answers a navigation it has no document for
 * with a *different* route's cached document, so Next's router reports the route that document was
 * rendered for while the address bar holds the route the person asked for. Anything reading
 * `usePathname`, `useParams` or `useSearchParams` directly resolves the wrong route, looks up the
 * wrong workspace, and fetches the wrong entity — and it does so only offline, which is where
 * nobody is watching.
 *
 * `useRouter` is deliberately **not** restricted here. Navigation is a separate concern with its own
 * offline path; this rule is about reading the current URL.
 *
 * @type {import('typescript-eslint').ConfigArray}
 */
// The three trees the location provider covers. Everything else — `(auth)`, `(marketing)`,
// `(public)`, `onboarding` — renders outside it and correctly keeps Next's own hooks.
const APP_LOCATION_SURFACES = [
  'apps/web/src/app/(app)/**/*.{ts,tsx}',
  'apps/web/src/components/**/*.{ts,tsx}',
  'apps/web/src/lib/**/*.{ts,tsx}',
];

export const appLocationConfig = [
  {
    files: APP_LOCATION_SURFACES,
    // The module that implements the replacement is the one place Next's hooks are the right answer.
    ignores: ['apps/web/src/lib/app-location.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'next/navigation',
              importNames: ['useParams', 'usePathname', 'useSearchParams'],
              message:
                "Read the URL through useAppParams/useAppPathname/useAppSearchParams from @/lib/app-location. Next's router reports the route the cached document was rendered for, not the route the person is on. See docs/engineering/specs/offline.md.",
            },
          ],
        },
      ],
    },
  },
];

/** Product trees where a shared primitive must own overlay and surface infrastructure. */
const UI_OWNERSHIP_SURFACES = [
  'packages/ui/src/components/**/*.{ts,tsx}',
  'apps/web/src/components/**/*.{ts,tsx}',
  'apps/web/src/app/(app)/**/*.{ts,tsx}',
];

/** Radix packages may only appear in the primitives that wrap their accessibility behavior. */
const RADIX_OVERLAY_PACKAGES = [
  '@radix-ui/react-dialog',
  '@radix-ui/react-popover',
  '@radix-ui/react-dropdown-menu',
  '@radix-ui/react-context-menu',
  '@radix-ui/react-hover-card',
  '@radix-ui/react-tooltip',
];

const MENU_STYLE_EXPORTS = [
  'menuBadge',
  'menuCheckedItemClass',
  'menuContentClass',
  'menuDestructiveItem',
  'menuFocusRing',
  'menuGroup',
  'menuItemClass',
  'menuLabel',
  'menuSeparator',
  'menuSupporting',
  'menuTrailingText',
];

/**
 * Keep product overlay behavior inside the shared primitive layer.
 *
 * This policy is ready to enable for every product tree after the remaining menu-style builder
 * imports migrate. The primitive implementation is deliberately exempt because it is the one
 * layer that owns Radix and visual geometry.
 */
export const overlayPrimitiveConfig = [
  {
    files: UI_OWNERSHIP_SURFACES,
    ignores: ['packages/ui/src/primitives/**/*'],
    plugins: { 'docket-ui': uiOwnershipPlugin },
    rules: {
      'docket-ui/no-bespoke-overlay': 'error',
      'docket-ui/no-overlay-style-override': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...RADIX_OVERLAY_PACKAGES.map((name) => ({
              name,
              message:
                'Use the typed overlay exported by @docket/ui/primitives. Radix belongs inside packages/ui/src/primitives.',
            })),
          ],
        },
      ],
    },
  },
];

/** Keep feature code from rebuilding the MD3 menu system from low-level class helpers. */
export const menuStyleBoundaryConfig = [
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@docket/ui/primitives',
              importNames: MENU_STYLE_EXPORTS,
              message:
                'Use DropdownMenu, ContextMenu, PickerList, MenuListbox, MenuActionRow, or VirtualMenuSurface instead of menu style builders.',
            },
          ],
        },
      ],
    },
  },
];

/** Require product resting regions to name a semantic owner rather than a raw tonal token. */
export const semanticSurfaceConfig = [
  {
    files: UI_OWNERSHIP_SURFACES,
    ignores: ['packages/ui/src/primitives/**/*'],
    plugins: { 'docket-ui': uiOwnershipPlugin },
    rules: { 'docket-ui/no-raw-surface-role': 'error' },
  },
];

/** Turn on the semantic-surface rule for a migrated directory without grandfathering old callers. */
export function semanticSurfaceCohortConfig(files) {
  return [
    {
      files,
      ignores: ['packages/ui/src/primitives/**/*'],
      plugins: { 'docket-ui': uiOwnershipPlugin },
      rules: { 'docket-ui/no-raw-surface-role': 'error' },
    },
  ];
}

/** Keep server route modules away from client query hooks. */
export const serverComponentBoundaryConfig = [
  {
    files: ['apps/web/src/app/**/{page,layout}.tsx'],
    plugins: { 'docket-ui': uiOwnershipPlugin },
    rules: {
      'docket-ui/no-server-query-import': 'error',
    },
  },
];

/** The complete UI ownership policy once all migrated product surfaces are clean. */
export const uiOwnershipConfig = [
  ...overlayPrimitiveConfig,
  ...menuStyleBoundaryConfig,
  ...semanticSurfaceConfig,
  ...serverComponentBoundaryConfig,
];

/**
 * Control-flow limits: the complexity gate.
 *
 * @remarks
 * The preset is strict about types and imports and was, until this landed, silent about control
 * flow — a function could grow to any shape and pass every gate. These four rules are the shape
 * check. `sonarjs/cognitive-complexity` earns its dependency by weighting nesting and charging a
 * nested closure to the function that holds it, which catches what cyclomatic complexity does not:
 * `packages/ui/src/components/views/flatten-groups.ts` scores 21 on cognitive complexity with no
 * function over the cyclomatic target at all.
 *
 * Only that one sonarjs rule is enabled. The plugin's recommended preset carries roughly three
 * hundred, which is a different decision that nobody has made.
 *
 * Violations that predate the gate are not held to these numbers — see
 * {@link complexityDebtConfig}. Full rationale in `docs/engineering/complexity-ratchet.md`.
 */
export const COMPLEXITY_TARGETS = Object.freeze({
  complexity: 12,
  'max-depth': 4,
  'max-params': 5,
  'sonarjs/cognitive-complexity': 15,
});

/** The rule entry each rule wants: sonarjs takes a bare number, the core rules take `{ max }`. */
function complexityRuleEntry(rule, limit) {
  return rule === 'sonarjs/cognitive-complexity' ? ['error', limit] : ['error', { max: limit }];
}

/** @type {import('typescript-eslint').ConfigArray} */
export const complexityConfig = [
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    plugins: { sonarjs },
    rules: Object.fromEntries(
      Object.entries(COMPLEXITY_TARGETS).map(([rule, target]) => [
        rule,
        complexityRuleEntry(rule, target),
      ]),
    ),
  },
];

/**
 * Escape a literal path so minimatch reads it as a path and not as a pattern.
 *
 * @remarks
 * Sixteen ledgered paths carry a Next.js dynamic segment. Left alone, `orgs/[id]/page.tsx` is a
 * character class: it matches `orgs/i/page.tsx` and `orgs/d/page.tsx` and never the file itself, so
 * the relaxation would land on files that do not exist while the real file failed the gate.
 *
 * Nothing tests this. It fails in both directions and only one of them is loud: under-escaping
 * makes a relaxation miss, and the file then fails lint at the target, which someone notices;
 * over-escaping, or widening the character class, makes a pattern match files that were never
 * ledgered, and lint stays green while the gate quietly stops applying to them.
 */
function escapeGlob(path) {
  return path.replace(/[*?[\]{}!]/g, (character) => `\\${character}`);
}

const complexityDebt = JSON.parse(
  readFileSync(new URL('./complexity-debt.json', import.meta.url), 'utf8'),
);

/**
 * Per-file relaxations for complexity that predates the gate.
 *
 * @remarks
 * Turning these four rules on with no relaxations fails every file that already exceeded them, and
 * a gate that lands red gets disabled. `complexity-debt.json` records each such file's current
 * worst value and this block pins the file to it, so its worst function cannot get worse while new
 * and already-clean files are held to {@link COMPLEXITY_TARGETS}. The numbers may only ever be
 * lowered — `pnpm complexity:ledger` rewrites them from a measurement. Sign-off is an empty ledger.
 *
 * Grouped by `(rule, limit)` rather than one object per file: ESLint walks the whole config array
 * for every linted file, so several hundred single-file objects is a cost for no benefit.
 *
 * @type {import('typescript-eslint').ConfigArray}
 */
export const complexityDebtConfig = (() => {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const [file, rules] of Object.entries(complexityDebt)) {
    for (const [rule, limit] of Object.entries(rules)) {
      const key = `${rule} ${String(limit)}`;
      const files = groups.get(key);
      if (files === undefined) groups.set(key, [escapeGlob(file)]);
      else files.push(escapeGlob(file));
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, files]) => {
      const [rule, limit] = key.split(' ');
      return { files: files.sort(), rules: { [rule]: complexityRuleEntry(rule, Number(limit)) } };
    });
})();

export default baseConfig;
