/**
 * `@docket/env/marketing` — client/Next.js validated environment for `apps/marketing`.
 *
 * @remarks
 * The landing site needs only the public API/app URLs. Each `NEXT_PUBLIC_*` var is
 * listed literally in `runtimeEnv` so the bundler can inline it.
 */
import { createEnv } from '@t3-oss/env-nextjs';

import { clientShared } from './slices';

/** The validated public (browser) environment for apps/marketing. */
export const env = createEnv({
  client: {
    NEXT_PUBLIC_API_URL: clientShared.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_APP_URL: clientShared.NEXT_PUBLIC_APP_URL,
  },
  runtimeEnv: {
    NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'],
    NEXT_PUBLIC_APP_URL: process.env['NEXT_PUBLIC_APP_URL'],
  },
  emptyStringAsUndefined: true,
  skipValidation: Boolean(process.env['SKIP_ENV_VALIDATION']),
});

/** The inferred type of the validated marketing environment. */
export type MarketingEnv = typeof env;
