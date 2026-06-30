import js from '@eslint/js';
import tseslint from 'typescript-eslint';

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
        projectService: {
          allowDefaultProject: [
            'e2e/*.mjs',
            'e2e/helpers/*.mjs',
            'apps/web/e2e/*.mjs',
            'apps/web/e2e/helpers/*.mjs',
          ],
        },
        tsconfigRootDir: process.cwd(),
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
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
    // Tests legitimately use non-null assertions on known-seeded data and exercise
    // `any`-typed fixture/driver values; keep the strict rules everywhere else.
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.spec.mjs',
      '**/e2e/**/*.mjs',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // Playwright specs are `.mjs` and execute code in both Node and the browser page context.
    files: ['**/*.spec.mjs', '**/e2e/**/*.mjs'],
    languageOptions: {
      globals: {
        document: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/dot-notation': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
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
      '**/coverage/**',
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

export default baseConfig;
