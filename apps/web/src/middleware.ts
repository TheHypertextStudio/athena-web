/**
 * Next.js middleware for authentication and onboarding redirect.
 *
 * This middleware checks:
 * 1. If the path is protected
 * 2. If the user is authenticated
 * 3. If onboarding is complete/skipped
 *
 * If authenticated but onboarding is not complete, redirects to /onboarding.
 *
 * @packageDocumentation
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Public paths that don't require authentication.
 * These paths are accessible without a session.
 */
const PUBLIC_PATHS = [
  '/sign-in',
  '/sign-up',
  '/api/auth',
  '/api/dav',
  '/oauth',
  '/.well-known',
  '/_next',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
];

/**
 * Paths that require authentication but not onboarding completion.
 * Users can access these without finishing onboarding.
 */
const ONBOARDING_EXEMPT_PATHS = ['/onboarding', '/sign-out', '/api'];

/**
 * Protected paths that require both auth and onboarding completion.
 */
const PROTECTED_PATHS = ['/home', '/calendar', '/tasks', '/projects', '/initiatives', '/settings'];

/**
 * Check if the path matches any pattern in the list.
 */
function matchesPath(pathname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => pathname === pattern || pathname.startsWith(`${pattern}/`));
}

/**
 * Check if the user has a valid session by looking at cookies.
 * We check for the Better Auth session cookie.
 */
function hasSessionCookie(request: NextRequest): boolean {
  // Better Auth uses 'better-auth.session_token' in development
  // and '__Secure-better-auth.session_token' in production
  const hasDevSession = request.cookies.has('better-auth.session_token');
  const hasProdSession = request.cookies.has('__Secure-better-auth.session_token');
  return hasDevSession || hasProdSession;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (matchesPath(pathname, PUBLIC_PATHS)) {
    return NextResponse.next();
  }

  // Check if user has a session
  const hasSession = hasSessionCookie(request);

  // If no session and trying to access protected path, redirect to sign-in
  if (!hasSession) {
    if (matchesPath(pathname, PROTECTED_PATHS) || pathname === '/onboarding') {
      const signInUrl = new URL('/sign-in', request.url);
      signInUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(signInUrl);
    }
    return NextResponse.next();
  }

  // User has session - check onboarding status for protected paths
  if (matchesPath(pathname, PROTECTED_PATHS)) {
    // We need to check onboarding status
    // Since we can't make async calls to our API easily in edge middleware,
    // we use a cookie to cache the onboarding status
    const onboardingComplete = request.cookies.get('athena-onboarding-complete')?.value;

    // If onboarding status is cached and complete/skipped, allow access
    if (onboardingComplete === 'true') {
      return NextResponse.next();
    }

    // If no cached status or status is incomplete, check with API
    // We can't make cross-origin requests from edge middleware easily,
    // so we use a client-side check instead via a response header
    const response = NextResponse.next();
    response.headers.set('x-onboarding-check', 'required');
    return response;
  }

  // Allow onboarding-exempt paths
  if (matchesPath(pathname, ONBOARDING_EXEMPT_PATHS)) {
    return NextResponse.next();
  }

  // Default: redirect root to home (which will trigger onboarding check)
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/home', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
