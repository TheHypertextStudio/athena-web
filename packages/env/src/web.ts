/**
 * `@docket/env/web` — client/Next.js validated environment for `apps/web`.
 *
 * @remarks
 * Uses `createEnv` from `@t3-oss/env-nextjs`. Every `NEXT_PUBLIC_*` var is listed
 * **literally** in `runtimeEnv` (no `...process.env` spread) so Next's bundler can
 * statically inline the values into the client bundle.
 */
import { createEnv } from '@t3-oss/env-nextjs';

import { clientShared } from './slices';

/** The validated public (browser) environment for apps/web. */
export const env = createEnv({
  client: clientShared,
  runtimeEnv: {
    NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'],
    NEXT_PUBLIC_APP_URL: process.env['NEXT_PUBLIC_APP_URL'],
    NEXT_PUBLIC_PASSKEY_RP_ID: process.env['NEXT_PUBLIC_PASSKEY_RP_ID'],
    NEXT_PUBLIC_ROOT_DOMAIN: process.env['NEXT_PUBLIC_ROOT_DOMAIN'],
    NEXT_PUBLIC_BRIEF_HOST: process.env['NEXT_PUBLIC_BRIEF_HOST'],
    NEXT_PUBLIC_SUPPORT_EMAIL: process.env['NEXT_PUBLIC_SUPPORT_EMAIL'],
  },
  emptyStringAsUndefined: true,
  skipValidation: Boolean(process.env['SKIP_ENV_VALIDATION']),
});

/** The inferred type of the validated web environment. */
export type WebEnv = typeof env;
