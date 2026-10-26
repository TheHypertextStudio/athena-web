import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import { DemoBudgetExceeded } from './demo-budget';

/** A private reviewer link's email-bound credential, exchanged only by POST. */
export interface DemoLinkCredential {
  readonly slug: string;
  readonly email: string;
  readonly token: string;
}

/** Resolve a live demo credential to an existing, provisioned user; never create an account. */
export type ResolveDemoSignIn = (credential: DemoLinkCredential) => Promise<string | null>;

/**
 * Exchange an operator-supplied reviewer link for a normal session without an inbox round trip.
 * @param resolve - Checks the digest, account membership and live access rules; absent fails closed.
 */
export function demoLink(resolve?: ResolveDemoSignIn): BetterAuthPlugin {
  return {
    id: 'demo-link',
    endpoints: {
      signInDemoLink: createAuthEndpoint(
        '/sign-in/demo-link',
        {
          method: 'POST',
          body: z.object({
            slug: z.string().min(1).max(64),
            email: z.email(),
            token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          }),
        },
        async (ctx) => {
          const credential = { ...ctx.body, email: ctx.body.email.trim().toLowerCase() };
          let userId: string | null | undefined;
          try {
            userId = await resolve?.(credential);
          } catch (error) {
            if (!(error instanceof DemoBudgetExceeded)) throw error;
            ctx.setHeader('Retry-After', String(error.retryAfter));
            throw new APIError('TOO_MANY_REQUESTS', {
              code: 'RATE_LIMITED',
              message: 'Too many requests. Please try again later.',
            });
          }
          const user = userId ? await ctx.context.internalAdapter.findUserById(userId) : null;
          if (user?.email.toLowerCase() !== credential.email) {
            throw new APIError('BAD_REQUEST', {
              code: 'INVALID_DEMO_LINK',
              message: 'This sign-in link is unavailable.',
            });
          }
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ status: true, user: { id: user.id, email: user.email } });
        },
      ),
    },
    rateLimit: [{ pathMatcher: (path) => path === '/sign-in/demo-link', window: 60, max: 10 }],
  };
}
