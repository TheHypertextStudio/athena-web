/**
 * `@docket/env/admin` — client/Next.js validated environment for `apps/admin`.
 *
 * @remarks
 * The service-admin back-office needs only the public API/app URLs on the client;
 * staff-gating happens server-side. Each `NEXT_PUBLIC_*` var is listed literally in
 * `runtimeEnv` so the bundler can inline it.
 */
import { createEnv } from '@t3-oss/env-nextjs';

import { clientShared } from './slices';

/** The validated public (browser) environment for apps/admin. */
export const env = createEnv({
  client: {
    NEXT_PUBLIC_API_URL: clientShared.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_APP_URL: clientShared.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_PASSKEY_RP_ID: clientShared.NEXT_PUBLIC_PASSKEY_RP_ID,
  },
  runtimeEnv: {
    NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'],
    NEXT_PUBLIC_APP_URL: process.env['NEXT_PUBLIC_APP_URL'],
    NEXT_PUBLIC_PASSKEY_RP_ID: process.env['NEXT_PUBLIC_PASSKEY_RP_ID'],
  },
  emptyStringAsUndefined: true,
  skipValidation: Boolean(process.env['SKIP_ENV_VALIDATION']),
});

/** The inferred type of the validated admin environment. */
export type AdminEnv = typeof env;
